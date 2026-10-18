package farcaster

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"slices"
	"strings"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"golang.org/x/crypto/sha3"
	"golang.org/x/text/unicode/norm"
)

// The pieces of viem's mnemonicToAccount(...).signTypedData(...) the signer
// registration needs: BIP-39 seed, BIP-32 derivation on m/44'/60'/0'/0/0 and
// an EIP-712 SignedKeyRequest signature.

// mnemonicToKey is @scure/bip39 mnemonicToSeedSync + @scure/bip32 derive.
func mnemonicToKey(mnemonic string) (*btcec.PrivateKey, error) {
	normalized := norm.NFKD.String(mnemonic)
	if !slices.Contains([]int{12, 15, 18, 21, 24}, len(strings.Split(normalized, " "))) {
		return nil, errors.New("Invalid mnemonic")
	}
	seed, err := pbkdf2.Key(sha512.New, normalized, []byte("mnemonic"), 2048, 64)
	if err != nil {
		return nil, err
	}
	sum := hmacSHA512([]byte("Bitcoin seed"), seed)
	key, chain := sum[:32], sum[32:]
	const hardened = 0x80000000
	for _, index := range []uint32{44 + hardened, 60 + hardened, hardened, 0, 0} {
		var data []byte
		if index >= hardened {
			data = append([]byte{0}, key...)
		} else {
			data = privateKey(key).PubKey().SerializeCompressed()
		}
		data = binary.BigEndian.AppendUint32(data, index)
		sum = hmacSHA512(chain, data)
		var tweak, parent btcec.ModNScalar
		if tweak.SetByteSlice(sum[:32]) {
			return nil, errors.New("Tweak bigger than curve order")
		}
		parent.SetByteSlice(key)
		tweak.Add(&parent)
		if tweak.IsZero() {
			return nil, errors.New("The tweak was out of range or the resulted private key is invalid")
		}
		child := tweak.Bytes()
		key, chain = child[:], sum[32:]
	}
	return privateKey(key), nil
}

func privateKey(key []byte) *btcec.PrivateKey {
	priv, _ := btcec.PrivKeyFromBytes(key)
	return priv
}

func hmacSHA512(key, data []byte) []byte {
	mac := hmac.New(sha512.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func keccak(parts ...[]byte) []byte {
	h := sha3.NewLegacyKeccak256()
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

func uint256(n uint64) []byte {
	out := make([]byte, 32)
	binary.BigEndian.PutUint64(out[24:], n)
	return out
}

// SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN / SIGNED_KEY_REQUEST_TYPE.
const (
	domainName              = "Farcaster SignedKeyRequestValidator"
	domainVersion           = "1"
	domainChainID           = 10
	domainVerifyingContract = "0x00000000fc700472606ed4fa22623acf62c60553"
)

// signedKeyRequestDigest is the EIP-712 hash viem's signTypedData signs.
func signedKeyRequestDigest(requestFid uint64, key []byte, deadline uint64) []byte {
	contract, _ := hex.DecodeString(strings.TrimPrefix(domainVerifyingContract, "0x"))
	domain := keccak(
		keccak([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
		keccak([]byte(domainName)),
		keccak([]byte(domainVersion)),
		uint256(domainChainID),
		append(make([]byte, 12), contract...),
	)
	message := keccak(
		keccak([]byte("SignedKeyRequest(uint256 requestFid,bytes key,uint256 deadline)")),
		uint256(requestFid),
		keccak(key),
		uint256(deadline),
	)
	return keccak([]byte{0x19, 0x01}, domain, message)
}

// signTypedData returns viem's serialized signature: 0x r || s || v (27/28).
func signTypedData(priv *btcec.PrivateKey, requestFid uint64, key []byte, deadline uint64) string {
	compact := ecdsa.SignCompact(priv, signedKeyRequestDigest(requestFid, key, deadline), false)
	return "0x" + hex.EncodeToString(append(compact[1:], compact[0]))
}

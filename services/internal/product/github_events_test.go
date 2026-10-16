package product

import "testing"

func TestRepositoryFileReadsOnlyTheSourceRepository(t *testing.T) {
	const raw = "https://raw.githubusercontent.com/Acme/App/main/docs/shot.png"
	for imageURL, want := range map[string]string{
		"https://github.com/acme/app/blob/main/docs/shot.png?raw=true": raw[:34] + "acme/app/main/docs/shot.png",
		"https://github.com/acme/app/raw/main/docs/shot.png":           raw[:34] + "acme/app/main/docs/shot.png",
		raw: raw,
		"https://raw.githubusercontent.com/acme/app/feature/x/a%20b.png":     raw[:34] + "acme/app/feature/x/a%20b.png",
		"https://github.com/acme/other/blob/main/shot.png?raw=true":          "",
		"https://raw.githubusercontent.com/acme/app/../other/main/shot.png":  "",
		"https://raw.githubusercontent.com/acme/app/%2e%2e/other/main/x.png": "",
		"https://github.com/acme/app/pull/1":                                 "",
		"https://github.com/user-attachments/assets/0f1c":                    "",
		"http://raw.githubusercontent.com/acme/app/main/shot.png":            "",
		"https://raw.githubusercontent.com.evil.test/acme/app/main/shot.png": "",
		"https://private-user-images.githubusercontent.com/1/2.png?jwt=x":    "",
	} {
		got, ok := repositoryFile(imageURL, "acme/App")
		if got != want || ok != (want != "") {
			t.Errorf("repositoryFile(%q) = %q, %v; want %q", imageURL, got, ok, want)
		}
	}
}

package profile

// Persona is one kind of buyer in an ideal customer profile
// (docs/rfcs/034-background-onboarding-agent.md).
type Persona struct {
	Role      string `json:"role"`
	Seniority string `json:"seniority,omitempty"`
	TeamSize  string `json:"teamSize,omitempty"`
}

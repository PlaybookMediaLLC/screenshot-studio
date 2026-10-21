package socialidentity

import "testing"

func TestConnectionAvailabilityRejectsAmbiguousCatalog(t *testing.T) {
	valid := func() ConnectionAvailability {
		out := ConnectionAvailability{Version: 1}
		for _, id := range ConnectionProviders() {
			out.Providers = append(out.Providers, ProviderAvailability{Provider: id, Status: "disabled"})
		}
		return out
	}
	if valid().Validate() != nil {
		t.Fatal("complete catalog rejected")
	}
	for _, mutate := range []func(*ConnectionAvailability){
		func(a *ConnectionAvailability) { a.Version = 2 },
		func(a *ConnectionAvailability) { a.Providers = a.Providers[1:] },
		func(a *ConnectionAvailability) { a.Providers[0] = a.Providers[1] },
		func(a *ConnectionAvailability) { a.Providers[0].Provider = "unknown" },
		func(a *ConnectionAvailability) { a.Providers[0].Status = "healthy" },
	} {
		catalog := valid()
		mutate(&catalog)
		if catalog.Validate() == nil {
			t.Fatal("ambiguous catalog accepted")
		}
	}
}

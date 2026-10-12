//go:build ignore

package main

import (
	"log"

	"entgo.io/ent/entc"
	"entgo.io/ent/entc/gen"
)

func main() {
	err := entc.Generate("./schema", &gen.Config{
		Features:  []gen.Feature{gen.FeatureUpsert, gen.FeatureExecQuery, gen.FeatureModifier, gen.FeatureLock},
		Templates: []*gen.Template{gen.MustParse(gen.NewTemplate("prismajson").Funcs(gen.Funcs).ParseFiles("template/prismajson.tmpl"))},
	})
	if err != nil {
		log.Fatalf("running ent codegen: %v", err)
	}
}

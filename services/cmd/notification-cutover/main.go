// Command notification-cutover imports reviewed legacy mappings without historical sends.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
)

func main() {
	file := flag.String("mapping", "", "reviewed mapping JSON file")
	apply := flag.Bool("apply", false, "commit after old senders are stopped and drained")
	flag.Parse()
	if *apply && os.Getenv("PLATFORM_ACTIVITY_LEGACY_PAUSED") != "true" {
		log.Fatal("PLATFORM_ACTIVITY_LEGACY_PAUSED=true is required; drain existing activity email workflows first")
	}
	input, err := os.Open(*file)
	if err != nil {
		log.Fatal(err)
	}
	defer input.Close()
	var mapping notifications.LegacyImport
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&mapping); err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	result, err := notifications.New(db.SQL, db.Client).ImportLegacy(ctx, mapping, *apply)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("applied=%t items=%d recipient_copies=%d review_events=%d", *apply, result.Items, result.Copies, result.ReviewEvents)
}

# Dashboards

`onboarding.json` is the onboarding agent's Grafana dashboard
(docs/rfcs/034-background-onboarding-agent.md, Observability). Import it and
pick a PostgreSQL datasource that reads a replica as a read-only role. Every
panel reads `onboarding_run` only: fast-path latency, outcome rates, pages
and tokens per run, model and enrichment cost per run (the platform pays
both; onboarding spends no AI credits), and why runs stopped early.

The backend also logs one structured line per fast path
(`metric=onboarding.fast_path`, with the stages that ran out of time) and per
finished run (`metric=onboarding.run`), for log-based alerts.

Request, job, database and runtime monitors for the OpenTelemetry data in
Axiom are in [docs/observability.md](../../docs/observability.md#dashboards-and-monitors).

"""Project Vercel's official OpenAPI document onto the two read operations we use.

Usage: python3 refresh.py /path/to/downloaded-vercel-openapi.json
Download source: https://openapi.vercel.sh/
Then run go generate in this directory and review the resulting diff.
"""

import copy
import hashlib
import json
import pathlib
import sys

raw = pathlib.Path(sys.argv[1]).read_bytes()
upstream = json.loads(raw)
paths = {}
for path in ("/v9/projects/{idOrName}", "/v1/deployments/{deploymentId}/checks"):
    operation = copy.deepcopy(upstream["paths"][path]["get"])
    operation["responses"] = {"200": operation["responses"]["200"]}
    schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    if operation["operationId"] == "getProject":
        fields = ("id", "accountId")
        schema["properties"] = {key: schema["properties"][key] for key in fields}
        schema["required"] = [key for key in schema["required"] if key in fields]
    else:
        check = schema["properties"]["checks"]["items"]
        fields = ("id", "integrationId", "name", "status", "conclusion", "updatedAt")
        check["properties"] = {key: check["properties"][key] for key in fields}
        check["required"] = [key for key in check["required"] if key in fields]
    paths[path] = {"get": operation}

spec = {
    "openapi": upstream["openapi"],
    "info": upstream["info"],
    "servers": [{"url": "https://api.vercel.com"}],
    "paths": paths,
    "components": {"securitySchemes": upstream["components"]["securitySchemes"]},
    "x-shots-upstream": {
        "url": "https://openapi.vercel.sh/",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "projection": "Read operations and evidence fields only; upstream paths, parameters and field types retained.",
    },
}
pathlib.Path(__file__).with_name("openapi.json").write_text(json.dumps(spec, indent=2) + "\n")

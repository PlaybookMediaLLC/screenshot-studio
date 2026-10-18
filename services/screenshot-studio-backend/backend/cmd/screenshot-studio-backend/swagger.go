package main

import (
	"net/http"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// loadSwagger serves the Swagger UI on /docs and the document on /docs-json.
// The document lists every registered route (method + path) and nothing more.
func loadSwagger(r *httpx.Router) {
	paths := map[string]map[string]any{}
	for _, rt := range r.Routes() {
		path := toOpenAPIPath(rt.Path)
		methods := []string{rt.Method}
		if rt.Method == "*" {
			methods = []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}
		}
		if paths[path] == nil {
			paths[path] = map[string]any{}
		}
		for _, m := range methods {
			op := map[string]any{"responses": map[string]any{"default": map[string]any{"description": ""}}}
			if params := pathParams(rt.Path); len(params) > 0 {
				op["parameters"] = params
			}
			paths[path][strings.ToLower(m)] = op
		}
	}
	document := map[string]any{
		"openapi": "3.0.0",
		"info":    map[string]any{"title": "screenshot-studio-backend", "description": "API description", "version": "1.0", "contact": map[string]any{}},
		"tags":    []any{},
		"servers": []any{},
		"components": map[string]any{
			"schemas": map[string]any{},
		},
		"paths": paths,
	}
	g := r.Group("/")
	g.Get("/docs-json", func(c *httpx.Ctx) (any, error) { return document, nil })
	g.Get("/docs", func(c *httpx.Ctx) (any, error) {
		c.SetHeader("Content-Type", "text/html; charset=utf-8")
		return swaggerHTML, nil
	})
}

func toOpenAPIPath(path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if strings.HasPrefix(p, ":") {
			parts[i] = "{" + p[1:] + "}"
		}
	}
	return strings.Join(parts, "/")
}

func pathParams(path string) []map[string]any {
	var out []map[string]any
	for _, p := range strings.Split(path, "/") {
		if strings.HasPrefix(p, ":") {
			out = append(out, map[string]any{"name": p[1:], "in": "path", "required": true, "schema": map[string]any{"type": "string"}})
		}
	}
	return out
}

const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Swagger UI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: "/docs-json", dom_id: "#swagger-ui" });</script>
</body>
</html>
`

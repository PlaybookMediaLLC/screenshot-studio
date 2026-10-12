// Package httpx is the HTTP layer the Postiz backend controllers are ported
// onto. It keeps the NestJS/Express behavior Postiz clients rely on: routes
// match in registration order with ":param" segments, handlers return the
// response body, POST answers 201 by default, and errors render the same JSON
// bodies Nest's exception filters produce.
package httpx

import (
	"net/http"
	"net/url"
	"strings"
)

// Handler returns the response body. A nil body sends an empty response, a
// string is sent as text, anything else is JSON encoded.
type Handler func(c *Ctx) (any, error)

// Middleware runs before a handler; it may stop the chain by returning an error
// or by writing the response itself and returning ErrHandled.
type Middleware func(c *Ctx) error

type route struct {
	method      string
	segments    []string
	handler     Handler
	middlewares []Middleware
	status      int
	raw         bool
	doc         RouteDoc
}

// Router matches routes in registration order like Express.
type Router struct {
	routes   []*route
	before   []Middleware
	NotFound http.Handler
}

func NewRouter() *Router { return &Router{} }

// Use adds middleware that runs for every matched route, before route middleware.
func (r *Router) Use(m ...Middleware) { r.before = append(r.before, m...) }

// Group registers routes under a prefix with shared middleware, like a Nest controller.
type Group struct {
	router      *Router
	prefix      string
	middlewares []Middleware
	doc         RouteDoc
}

func (r *Router) Group(prefix string, m ...Middleware) *Group {
	return &Group{router: r, prefix: strings.TrimSuffix(prefix, "/"), middlewares: m}
}

// RouteOption customizes one route.
type RouteOption func(*route)

// Status overrides the default status code (Nest's @HttpCode).
func Status(code int) RouteOption { return func(r *route) { r.status = code } }

// Raw marks a handler that writes the response itself (Nest's @Res()).
func Raw() RouteOption { return func(r *route) { r.raw = true } }

// With adds route-level middleware (guards).
func With(m ...Middleware) RouteOption {
	return func(r *route) { r.middlewares = append(r.middlewares, m...) }
}

func (g *Group) Handle(method, path string, h Handler, opts ...RouteOption) {
	full := g.prefix + "/" + strings.TrimPrefix(path, "/")
	rt := &route{method: method, segments: split(full), handler: h, middlewares: append([]Middleware{}, g.middlewares...), doc: g.doc}
	for _, opt := range opts {
		opt(rt)
	}
	g.router.routes = append(g.router.routes, rt)
}

func (g *Group) Get(path string, h Handler, opts ...RouteOption) {
	g.Handle(http.MethodGet, path, h, opts...)
}
func (g *Group) Post(path string, h Handler, opts ...RouteOption) {
	g.Handle(http.MethodPost, path, h, opts...)
}
func (g *Group) Put(path string, h Handler, opts ...RouteOption) {
	g.Handle(http.MethodPut, path, h, opts...)
}
func (g *Group) Patch(path string, h Handler, opts ...RouteOption) {
	g.Handle(http.MethodPatch, path, h, opts...)
}
func (g *Group) Delete(path string, h Handler, opts ...RouteOption) {
	g.Handle(http.MethodDelete, path, h, opts...)
}

// All matches any method (Nest's @All()).
func (g *Group) All(path string, h Handler, opts ...RouteOption) { g.Handle("*", path, h, opts...) }

// RouteInfo is one registered route. Status is the status a successful
// response gets (Nest's @HttpCode, else 201 for POST and 200 otherwise).
type RouteInfo struct {
	Method, Path string
	Status       int
	Doc          RouteDoc
}

// Routes lists the registered routes in match order ("*" = any method).
func (r *Router) Routes() []RouteInfo {
	out := make([]RouteInfo, len(r.routes))
	for i, rt := range r.routes {
		status := rt.status
		if status == 0 {
			status = http.StatusOK
			if rt.method == http.MethodPost {
				status = http.StatusCreated
			}
		}
		out[i] = RouteInfo{Method: rt.method, Path: "/" + strings.Join(rt.segments, "/"), Status: status, Doc: rt.doc}
	}
	return out
}

// RouteDoc is a route's OpenAPI metadata: what @nestjs/swagger reads from the
// controller decorators (@ApiTags, @Param, @Query, @Body, @UploadedFile,
// @HttpCode), plus the response shapes and auth Nest leaves out. It never
// changes how the route runs. DTOs are Go values whose type is the schema.
type RouteDoc struct {
	Controller  string   // Nest controller class; operationId = Controller_Operation
	Operation   string   // controller method name
	Tags        []string // @ApiTags
	Security    []string // alternative security schemes; empty non-nil = public
	Description string
	Body        any      // @Body() dto (JSON)
	BodyFields  []string // @Body('name') strings (form fields when Files is set)
	Files       []string // @UploadedFile fields: the body is multipart/form-data
	Query       any      // @Query() dto: one query parameter per field
	QueryParams []string // @Query('name')
	Headers     []string // @Headers('name')
	Responses   []DocResponse
}

// DocResponse is one documented response. ContentType "" means JSON, or
// text/html for a string Body (Express's res.send); a nil Body has no content.
type DocResponse struct {
	Status      int
	ContentType string
	Body        any
}

// Doc names the Nest controller class and its @ApiTags for the routes
// registered on the group afterwards.
func (g *Group) Doc(controller string, tags ...string) *Group {
	g.doc.Controller, g.doc.Tags = controller, tags
	return g
}

// Security sets the security schemes (alternatives) of the group's routes.
func (g *Group) Security(schemes ...string) *Group {
	g.doc.Security = append([]string{}, schemes...)
	return g
}

// Op names the controller method (the operationId suffix).
func Op(name string) RouteOption { return func(r *route) { r.doc.Operation = name } }

// Describe sets the operation description.
func Describe(text string) RouteOption { return func(r *route) { r.doc.Description = text } }

// Body documents a @Body() dto.
func Body(dto any) RouteOption { return func(r *route) { r.doc.Body = dto } }

// BodyField documents @Body('name') string fields.
func BodyField(names ...string) RouteOption {
	return func(r *route) { r.doc.BodyFields = append(r.doc.BodyFields, names...) }
}

// Multipart documents @UploadedFile fields: a multipart/form-data body.
func Multipart(files ...string) RouteOption {
	return func(r *route) { r.doc.Files = append(r.doc.Files, files...) }
}

// Query documents a @Query() dto.
func Query(dto any) RouteOption { return func(r *route) { r.doc.Query = dto } }

// QueryParam documents @Query('name') parameters.
func QueryParam(names ...string) RouteOption {
	return func(r *route) { r.doc.QueryParams = append(r.doc.QueryParams, names...) }
}

// HeaderParam documents @Headers('name') parameters.
func HeaderParam(names ...string) RouteOption {
	return func(r *route) { r.doc.Headers = append(r.doc.Headers, names...) }
}

// Response documents a response body (see DocResponse).
func Response(status int, body any) RouteOption { return ResponseContent(status, "", body) }

// ResponseContent documents a response with an explicit content type
// (streams, files).
func ResponseContent(status int, contentType string, body any) RouteOption {
	return func(r *route) {
		r.doc.Responses = append(r.doc.Responses, DocResponse{Status: status, ContentType: contentType, Body: body})
	}
}

// Security overrides the route's security schemes; no schemes = public.
func Security(schemes ...string) RouteOption {
	return func(r *route) { r.doc.Security = append([]string{}, schemes...) }
}

func split(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func (rt *route) match(method string, parts []string) (map[string]string, bool) {
	if rt.method != "*" && rt.method != method && !(rt.method == http.MethodGet && method == http.MethodHead) {
		return nil, false
	}
	params := map[string]string{}
	for i, seg := range rt.segments {
		// "*" and "{*splat}" match the rest of the path, including nothing.
		if seg == "*" || strings.HasPrefix(seg, "{*") {
			params["*"] = strings.Join(parts[min(i, len(parts)):], "/")
			return params, true
		}
		if i >= len(parts) {
			return nil, false
		}
		if strings.HasPrefix(seg, ":") {
			value, err := url.PathUnescape(parts[i])
			if err != nil {
				return nil, false
			}
			params[seg[1:]] = value
			continue
		}
		if !strings.EqualFold(seg, parts[i]) {
			return nil, false
		}
	}
	return params, len(parts) == len(rt.segments)
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	parts := split(req.URL.Path)
	for _, rt := range r.routes {
		params, ok := rt.match(req.Method, parts)
		if !ok {
			continue
		}
		c := newCtx(w, req, params)
		r.serve(c, rt)
		return
	}
	if r.NotFound != nil {
		r.NotFound.ServeHTTP(w, req)
		return
	}
	writeJSON(w, req, http.StatusNotFound, namedBody{Message: "Cannot " + req.Method + " " + req.URL.Path, Error: "Not Found", StatusCode: 404})
}

func (r *Router) serve(c *Ctx, rt *route) {
	defer func() {
		if p := recover(); p != nil {
			c.fail(panicError(p))
		}
	}()
	for _, m := range r.before {
		if err := m(c); err != nil {
			c.fail(err)
			return
		}
	}
	for _, m := range rt.middlewares {
		if err := m(c); err != nil {
			c.fail(err)
			return
		}
	}
	body, err := rt.handler(c)
	if err != nil {
		c.fail(err)
		return
	}
	if rt.raw || c.written {
		return
	}
	status := rt.status
	if status == 0 {
		status = http.StatusOK
		if c.R.Method == http.MethodPost {
			status = http.StatusCreated
		}
	}
	c.send(status, body)
}

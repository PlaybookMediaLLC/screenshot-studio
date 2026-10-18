package helpers

import (
	"bytes"
	"encoding/json"
)

// Key mappings for minifying post list/calendar
// responses to reduce payload size (the frontend expands them).

var (
	postListKeys     = map[string]string{"posts": "p", "total": "t", "page": "pg", "limit": "l", "hasMore": "hm"}
	postCalendarKeys = map[string]string{"posts": "p"}
	postItemKeys     = map[string]string{
		"id": "i", "content": "c", "publishDate": "d", "releaseURL": "u", "releaseId": "ri",
		"state": "s", "group": "g", "tags": "tg", "integration": "n", "intervalInDays": "iv",
		"actualDate": "ad", "creationMethod": "cm",
	}
	integrationKeys = map[string]string{"id": "i", "providerIdentifier": "pi", "name": "n", "picture": "p"}
	tagKeys         = map[string]string{"tag": "t"}
	tagInnerKeys    = map[string]string{
		"id": "i", "name": "n", "color": "c", "orgId": "o", "createdAt": "ca", "updatedAt": "ua", "deletedAt": "da",
	}
)

func mapKeys(obj map[string]any, keyMap map[string]string) map[string]any {
	result := make(map[string]any, len(obj))
	for k, v := range obj {
		if short, ok := keyMap[k]; ok {
			k = short
		}
		result[k] = v
	}
	return result
}

func minifyPostItem(item any) any {
	post, ok := item.(map[string]any)
	if !ok {
		return item
	}
	if integration, ok := post["integration"].(map[string]any); ok {
		post["integration"] = mapKeys(integration, integrationKeys)
	}
	// post.tags?.map(...): a missing or null list becomes undefined and is
	// dropped from the JSON
	if tags, ok := post["tags"].([]any); ok {
		for i, t := range tags {
			wrapper, ok := t.(map[string]any)
			if !ok {
				continue
			}
			if tag, ok := wrapper["tag"].(map[string]any); ok {
				wrapper["tag"] = mapKeys(tag, tagInnerKeys)
			}
			tags[i] = mapKeys(wrapper, tagKeys)
		}
	} else {
		delete(post, "tags")
	}
	return mapKeys(post, postItemKeys)
}

// toJSONMap converts entities/structs to their JSON object form.
func toJSONMap(v any) (map[string]any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out map[string]any
	return out, dec.Decode(&out)
}

func minifyWith(data map[string]any, keyMap map[string]string) map[string]any {
	posts, _ := data["posts"].([]any)
	minified := make([]any, len(posts))
	for i, p := range posts {
		minified[i] = minifyPostItem(p)
	}
	data["posts"] = minified
	return mapKeys(data, keyMap)
}

// MinifyPostsList is minifyPostsList for getPostsList; data marshals to
// {posts, total, page, limit, hasMore}.
func MinifyPostsList(data any) (map[string]any, error) {
	m, err := toJSONMap(data)
	if err != nil {
		return nil, err
	}
	return minifyWith(m, postListKeys), nil
}

// MinifyPosts is minifyPosts({posts}) for the calendar view.
func MinifyPosts(posts any) (map[string]any, error) {
	m, err := toJSONMap(map[string]any{"posts": posts})
	if err != nil {
		return nil, err
	}
	return minifyWith(m, postCalendarKeys), nil
}

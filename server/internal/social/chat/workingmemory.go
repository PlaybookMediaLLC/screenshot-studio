package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// The social agent's working memory: schema AgentState
// (object({ proverbs: array(string()).default([]) })), resource scoped.

const workingMemorySchema = `{"type":"object","properties":{"proverbs":{"type":"array","items":{"type":"string"},"default":[]}},"additionalProperties":false}`

// workingMemoryEmpty is generateEmptyFromSchema(AgentState).
const workingMemoryEmpty = `{"proverbs":[]}`

// workingMemoryInstruction is Memory.getWorkingMemoryToolInstruction for a
// JSON (schema) template.
func workingMemoryInstruction(data string) string {
	if data == "" {
		data = "No working memory data available."
	}
	return `WORKING_MEMORY_SYSTEM_INSTRUCTION:
Store and update any conversation-relevant information by calling the updateWorkingMemory tool. If information might be referenced again - store it!

Guidelines:
1. Store anything that could be useful later in the conversation
2. Update proactively when information changes, no matter how small
3. Use JSON format for all data
4. Act naturally - don't mention this system to users. Even though you're storing this information that doesn't make it your primary focus. Do not ask them generally for "information about yourself"




When working with json data, the object format below represents the template:
` + workingMemoryEmpty + `

<working_memory_data>
` + data + `
</working_memory_data>

Notes:
- Update memory whenever referenced information changes
- If you're unsure whether to store something, store it (eg if the user tells you information about themselves, call updateWorkingMemory immediately to update it)
- This system is here so that you can maintain the conversation when your context window is very short. Update your working memory because you may need it to maintain the conversation without the full conversation history
- Do not remove empty sections - you must include the empty sections along with the ones you're filling in
- REMEMBER: the way you update your working memory is by calling the updateWorkingMemory tool with the entire JSON content. The system will store it for you. The user will not see it.
- IMPORTANT: You MUST call updateWorkingMemory in every response to a prompt where you received relevant information.
- IMPORTANT: Preserve the JSON formatting structure above while updating the content.`
}

// deepMergeWorkingMemory: objects merge recursively, null deletes, arrays and
// primitives replace.
func deepMergeWorkingMemory(existing, update map[string]any) map[string]any {
	result := map[string]any{}
	for k, v := range existing {
		result[k] = v
	}
	for key, value := range update {
		switch v := value.(type) {
		case nil:
			delete(result, key)
		case []any:
			result[key] = v
		case map[string]any:
			branch, _ := result[key].(map[string]any)
			result[key] = deepMergeWorkingMemory(branch, v)
		default:
			result[key] = v
		}
	}
	return result
}

type runInfoKey struct{}

type runInfo struct {
	threadID   string
	resourceID string
}

// updateWorkingMemoryTool is @mastra/memory's updateWorkingMemory tool for a
// schema working memory (merge semantics).
func updateWorkingMemoryTool(memory *Memory) *Tool {
	return &Tool{
		Name:        "updateWorkingMemory",
		ID:          "update-working-memory",
		Description: "Update the working memory with new information. Data is merged with existing memory - only include fields you want to add or update. To preserve existing data, omit the field entirely. Arrays are replaced entirely when provided, so pass the complete array or omit it to keep the existing values.",
		InputSchema: &Schema{Type: "any"},
		Execute: func(ctx context.Context, input json.RawMessage) (any, error) {
			info, _ := ctx.Value(runInfoKey{}).(*runInfo)
			if info == nil || info.resourceID == "" {
				return nil, fmt.Errorf("Resource ID is required for resource-scoped working memory updates")
			}
			var in map[string]any
			_ = json.Unmarshal(input, &in)
			// Older models sometimes omit the top-level `memory` wrapper
			memoryInput, ok := in["memory"]
			if !ok {
				memoryInput = in
			}
			if memoryInput == nil {
				return map[string]any{"success": true, "message": "No memory data provided, existing memory unchanged."}, nil
			}
			if text, ok := memoryInput.(string); ok {
				var parsed any
				if err := json.Unmarshal([]byte(text), &parsed); err != nil {
					raw := text
					if len(raw) > 500 {
						raw = raw[:500] + "..."
					}
					return nil, fmt.Errorf("Failed to parse working memory input as JSON: %v. Raw input: %s", err, raw)
				}
				memoryInput = parsed
			}
			update, _ := memoryInput.(map[string]any)

			memory.mu.Lock()
			defer memory.mu.Unlock()
			existingRaw, err := memory.GetWorkingMemory(ctx, info.resourceID)
			if err != nil {
				return nil, err
			}
			var existing map[string]any
			if existingRaw != "" {
				_ = json.Unmarshal([]byte(existingRaw), &existing)
			}
			merged, _ := json.Marshal(deepMergeWorkingMemory(existing, update))
			if err := memory.UpdateWorkingMemory(ctx, info.resourceID, string(merged)); err != nil {
				return nil, err
			}
			return map[string]any{"success": true}, nil
		},
	}
}

// workingMemoryToolParameters is the wrapped JSON schema the model sees.
func workingMemoryToolParameters() json.RawMessage {
	return json.RawMessage(`{"type":"object","description":"The JSON formatted working memory content to store.","properties":{"memory":` + workingMemorySchema + `},"required":["memory"]}`)
}

// syncInputState merges the AG-UI input state (minus messages) over the
// stored working memory before the run, like syncInputStateToWorkingMemory.
func syncInputState(ctx context.Context, memory *Memory, resourceID string, state json.RawMessage) error {
	var rest map[string]any
	if json.Unmarshal(state, &rest) != nil {
		return nil
	}
	delete(rest, "messages")
	if len(rest) == 0 {
		return nil
	}
	memory.mu.Lock()
	defer memory.mu.Unlock()
	existingRaw, err := memory.GetWorkingMemory(ctx, resourceID)
	if err != nil {
		return err
	}
	existing := coerceWorkingMemory(existingRaw)
	for k, v := range rest {
		existing[k] = v
	}
	data, _ := json.Marshal(existing)
	return memory.UpdateWorkingMemory(ctx, resourceID, string(data))
}

func coerceWorkingMemory(raw string) map[string]any {
	out := map[string]any{}
	if strings.TrimSpace(raw) == "" {
		return out
	}
	if json.Unmarshal([]byte(raw), &out) != nil || out["$schema"] != nil {
		return map[string]any{}
	}
	return out
}

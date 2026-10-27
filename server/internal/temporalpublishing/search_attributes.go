package temporalpublishing

import (
	"context"
	"fmt"

	enumspb "go.temporal.io/api/enums/v1"
	operatorservice "go.temporal.io/api/operatorservice/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	OrganizationIDSearchAttributeName = "organizationId"
	PostIDSearchAttributeName         = "postId"
)

var (
	organizationIDSearchAttribute = temporal.NewSearchAttributeKeyString(OrganizationIDSearchAttributeName)
	postIDSearchAttribute         = temporal.NewSearchAttributeKeyString(PostIDSearchAttributeName)
)

func postSearchAttributes(organizationID, postID string) temporal.SearchAttributes {
	return temporal.NewSearchAttributes(
		organizationIDSearchAttribute.ValueSet(organizationID),
		postIDSearchAttribute.ValueSet(postID),
	)
}

func RegisterSearchAttributes(ctx context.Context, temporalClient client.Client, namespace string) error {
	operator := temporalClient.OperatorService()
	response, err := operator.ListSearchAttributes(ctx, &operatorservice.ListSearchAttributesRequest{Namespace: namespace})
	if err != nil {
		return fmt.Errorf("list Temporal search attributes: %w", err)
	}
	for _, name := range []string{OrganizationIDSearchAttributeName, PostIDSearchAttributeName} {
		valueType := enumspb.INDEXED_VALUE_TYPE_TEXT
		if existing, ok := response.CustomAttributes[name]; ok {
			if existing != valueType {
				return fmt.Errorf("Temporal search attribute %s has type %s, want %s", name, existing, valueType)
			}
			continue
		}
		_, err = operator.AddSearchAttributes(ctx, &operatorservice.AddSearchAttributesRequest{
			Namespace: namespace, SearchAttributes: map[string]enumspb.IndexedValueType{name: valueType},
		})
		if err != nil && status.Code(err) != codes.AlreadyExists {
			return fmt.Errorf("register Temporal search attribute %s: %w", name, err)
		}
	}
	return nil
}

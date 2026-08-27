package linear

import (
	"context"
	"fmt"
)

const issueFields = `
  id identifier title description priority estimate url createdAt updatedAt
  team { id } state { id } assignee { id } project { id } cycle { id }
  creator { name displayName }
  labels(first: 50) { nodes { id name color } }
`

func (c *Client) Viewer(ctx context.Context) (User, error) {
	var out struct {
		Viewer User `json:"viewer"`
	}
	err := c.Do(ctx, `query { viewer { id name displayName email active } }`, nil, &out)
	return out.Viewer, err
}

func (c *Client) Teams(ctx context.Context) ([]Team, error) {
	var out struct {
		Teams struct {
			Nodes    []Team   `json:"nodes"`
			PageInfo PageInfo `json:"pageInfo"`
		} `json:"teams"`
	}
	err := c.Do(ctx, `query { teams(first: 100) { nodes { id key name } pageInfo { hasNextPage endCursor } } }`, nil, &out)
	return out.Teams.Nodes, err
}

func (c *Client) WorkflowStates(ctx context.Context) ([]WorkflowState, error) {
	return paginate[WorkflowState](ctx, c, "workflowStates", `id name type color position team { id }`, nil)
}

func (c *Client) Labels(ctx context.Context) ([]Label, error) {
	return paginate[Label](ctx, c, "issueLabels", `id name color isGroup team { id }`, nil)
}

func (c *Client) Projects(ctx context.Context) ([]Project, error) {
	return paginate[Project](ctx, c, "projects", `id name state`, nil)
}

func (c *Client) Cycles(ctx context.Context) ([]Cycle, error) {
	// Only current and future cycles are useful triage targets.
	filter := map[string]any{"endsAt": map[string]any{"gt": "P0D"}}
	return paginate[Cycle](ctx, c, "cycles", `id number name startsAt endsAt team { id }`, filter)
}

func (c *Client) Users(ctx context.Context) ([]User, error) {
	filter := map[string]any{"active": map[string]any{"eq": true}}
	return paginate[User](ctx, c, "users", `id name displayName email active`, filter)
}

// paginate walks a filtered connection field to exhaustion.
func paginate[T any](ctx context.Context, c *Client, field, fields string, filter map[string]any) ([]T, error) {
	var all []T
	cursor := ""
	for {
		vars := map[string]any{}
		args := "first: 250"
		if filter != nil {
			args += ", filter: $filter"
			vars["filter"] = filter
		}
		if cursor != "" {
			args += ", after: $after"
			vars["after"] = cursor
		}
		decl := ""
		if len(vars) > 0 {
			decl = "("
			if filter != nil {
				decl += "$filter: " + filterTypeFor(field)
			}
			if cursor != "" {
				if filter != nil {
					decl += ", "
				}
				decl += "$after: String"
			}
			decl += ")"
		}
		q := fmt.Sprintf(`query %s { %s(%s) { nodes { %s } pageInfo { hasNextPage endCursor } } }`, decl, field, args, fields)
		var out map[string]struct {
			Nodes    []T      `json:"nodes"`
			PageInfo PageInfo `json:"pageInfo"`
		}
		if err := c.Do(ctx, q, vars, &out); err != nil {
			return all, err
		}
		conn := out[field]
		all = append(all, conn.Nodes...)
		if !conn.PageInfo.HasNextPage {
			return all, nil
		}
		cursor = conn.PageInfo.EndCursor
	}
}

func filterTypeFor(field string) string {
	switch field {
	case "cycles":
		return "CycleFilter"
	case "users":
		return "UserFilter"
	default:
		return "IssueFilter"
	}
}

// Issues pages through all issues matching filter.
func (c *Client) Issues(ctx context.Context, filter map[string]any, pageSize int, onPage func([]Issue) error) error {
	cursor := ""
	for {
		vars := map[string]any{"filter": filter, "first": pageSize}
		q := `query ($filter: IssueFilter, $first: Int, $after: String) {
		  issues(filter: $filter, first: $first, after: $after) {
		    nodes {` + issueFields + `}
		    pageInfo { hasNextPage endCursor }
		  }
		}`
		if cursor != "" {
			vars["after"] = cursor
		}
		var out struct {
			Issues struct {
				Nodes    []Issue  `json:"nodes"`
				PageInfo PageInfo `json:"pageInfo"`
			} `json:"issues"`
		}
		if err := c.Do(ctx, q, vars, &out); err != nil {
			return err
		}
		if err := onPage(out.Issues.Nodes); err != nil {
			return err
		}
		if !out.Issues.PageInfo.HasNextPage {
			return nil
		}
		cursor = out.Issues.PageInfo.EndCursor
	}
}

// CustomView is a saved Linear view; FilterData is IssueFilter-shaped JSON.
type CustomView struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Icon        string         `json:"icon"`
	Color       string         `json:"color"`
	ModelName   string         `json:"modelName"`
	FilterData  map[string]any `json:"filterData"`
	Team        *Ref           `json:"team"`
}

// CustomViews lists the workspace's saved views.
func (c *Client) CustomViews(ctx context.Context) ([]CustomView, error) {
	var out struct {
		CustomViews struct {
			Nodes    []CustomView `json:"nodes"`
			PageInfo PageInfo     `json:"pageInfo"`
		} `json:"customViews"`
	}
	q := `query { customViews(first: 100) {
	  nodes { id name description icon color modelName filterData team { id } }
	  pageInfo { hasNextPage endCursor }
	} }`
	err := c.Do(ctx, q, nil, &out)
	return out.CustomViews.Nodes, err
}

// IssueComments fetches the comment thread for one issue.
func (c *Client) IssueComments(ctx context.Context, issueID string) ([]Comment, error) {
	var out struct {
		Issue struct {
			Comments struct {
				Nodes []Comment `json:"nodes"`
			} `json:"comments"`
		} `json:"issue"`
	}
	q := `query ($id: String!) {
	  issue(id: $id) {
	    comments(first: 50) { nodes { id body createdAt user { name displayName } } }
	  }
	}`
	err := c.Do(ctx, q, map[string]any{"id": issueID}, &out)
	return out.Issue.Comments.Nodes, err
}

// UpdateIssue applies input (a partial IssueUpdateInput as a map; nil values
// clear fields) and returns the refreshed issue.
func (c *Client) UpdateIssue(ctx context.Context, issueID string, input map[string]any) (Issue, error) {
	var out struct {
		IssueUpdate struct {
			Success bool  `json:"success"`
			Issue   Issue `json:"issue"`
		} `json:"issueUpdate"`
	}
	q := `mutation ($id: String!, $input: IssueUpdateInput!) {
	  issueUpdate(id: $id, input: $input) {
	    success
	    issue {` + issueFields + `}
	  }
	}`
	err := c.Do(ctx, q, map[string]any{"id": issueID, "input": input}, &out)
	if err != nil {
		return Issue{}, err
	}
	if !out.IssueUpdate.Success {
		return Issue{}, fmt.Errorf("linear: issueUpdate reported failure")
	}
	return out.IssueUpdate.Issue, nil
}

package linear

type Ref struct {
	ID string `json:"id"`
}

type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Active      bool   `json:"active"`
}

type Team struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type WorkflowState struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Color    string  `json:"color"`
	Position float64 `json:"position"`
	Team     *Ref    `json:"team"`
}

type Label struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	IsGroup bool   `json:"isGroup"`
	Team    *Ref   `json:"team"`
}

type Project struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

type Cycle struct {
	ID       string   `json:"id"`
	Number   float64  `json:"number"`
	Name     string   `json:"name"`
	StartsAt string   `json:"startsAt"`
	EndsAt   string   `json:"endsAt"`
	Team     *Ref     `json:"team"`
}

type Issue struct {
	ID          string   `json:"id"`
	Identifier  string   `json:"identifier"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Priority    float64  `json:"priority"`
	Estimate    *float64 `json:"estimate"`
	URL         string   `json:"url"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
	Team        *Ref     `json:"team"`
	State       *Ref     `json:"state"`
	Assignee    *Ref     `json:"assignee"`
	Project     *Ref     `json:"project"`
	Cycle       *Ref     `json:"cycle"`
	Creator     *struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"creator"`
	Labels struct {
		Nodes []Label `json:"nodes"`
	} `json:"labels"`
}

type Comment struct {
	ID        string `json:"id"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	User      *struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"user"`
}

type PageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

package store

import "encoding/json"

// EnrichSettings gates deep enrichment. Every source is read-only by
// construction: agents reach them only through the server's toolbox proxy.
type EnrichSettings struct {
	Mode    string `json:"mode"` // fast | deep
	Sources struct {
		Repo struct {
			Enabled bool     `json:"enabled"`
			Paths   []string `json:"paths"`
		} `json:"repo"`
		GitHub struct {
			Enabled bool `json:"enabled"`
		} `json:"github"`
		Linear struct {
			Enabled bool `json:"enabled"`
		} `json:"linear"`
		Datadog struct {
			Enabled bool   `json:"enabled"`
			Site    string `json:"site"` // e.g. us5.datadoghq.com
		} `json:"datadog"`
		Gcloud struct {
			Enabled bool `json:"enabled"`
		} `json:"gcloud"`
	} `json:"sources"`
}

func (s *Store) GetEnrichSettings() EnrichSettings {
	var es EnrichSettings
	es.Mode = "fast"
	if raw, err := s.GetMeta("enrich_settings"); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), &es)
	}
	if es.Mode != "deep" {
		es.Mode = "fast"
	}
	return es
}

func (s *Store) SetEnrichSettings(es EnrichSettings) error {
	b, err := json.Marshal(es)
	if err != nil {
		return err
	}
	return s.SetMeta("enrich_settings", string(b))
}

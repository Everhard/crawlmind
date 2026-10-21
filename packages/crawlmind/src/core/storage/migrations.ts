/**
 * Schema migrations, applied in order. The database's `PRAGMA user_version` stores how many
 * have run. Never edit a released migration; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: crawls, pages, links
  `
  CREATE TABLE crawls (
    id            TEXT PRIMARY KEY,
    site          TEXT NOT NULL,
    start_url     TEXT NOT NULL,
    options_json  TEXT NOT NULL,
    status        TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    pages_crawled INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    robots_status INTEGER,
    user_agent    TEXT NOT NULL
  );
  CREATE INDEX crawls_site ON crawls (site, started_at);

  CREATE TABLE pages (
    id                INTEGER PRIMARY KEY,
    crawl_id          TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    url               TEXT NOT NULL,
    final_url         TEXT,
    status            INTEGER,
    fetch_error       TEXT,
    content_type      TEXT,
    depth             INTEGER,
    in_sitemap        INTEGER NOT NULL DEFAULT 0,
    sitemap_priority  REAL,
    blocked_by_robots INTEGER NOT NULL DEFAULT 0,
    redirect_count    INTEGER NOT NULL DEFAULT 0,
    ttfb_ms           REAL,
    download_ms       REAL,
    html_bytes        INTEGER,
    truncated         INTEGER NOT NULL DEFAULT 0,
    title             TEXT,
    meta_description  TEXT,
    h1_json           TEXT,
    canonical         TEXT,
    meta_robots       TEXT,
    x_robots_tag      TEXT,
    lang              TEXT,
    word_count        INTEGER,
    content_hash      TEXT,
    scripts_count     INTEGER,
    stylesheets_count INTEGER,
    mixed_content_json TEXT,
    template_id       INTEGER,
    fetched_at        TEXT,
    UNIQUE (crawl_id, url)
  );

  CREATE TABLE redirect_hops (
    page_id   INTEGER NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    hop_index INTEGER NOT NULL,
    url       TEXT NOT NULL,
    status    INTEGER NOT NULL,
    PRIMARY KEY (page_id, hop_index)
  );

  CREATE TABLE links (
    id             INTEGER PRIMARY KEY,
    crawl_id       TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    source_page_id INTEGER NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
    target_url     TEXT NOT NULL,
    anchor         TEXT NOT NULL,
    rel            TEXT NOT NULL,
    nofollow       INTEGER NOT NULL,
    is_internal    INTEGER NOT NULL,
    placement      TEXT NOT NULL
  );
  CREATE INDEX links_target ON links (crawl_id, target_url);
  CREATE INDEX links_source ON links (source_page_id);

  CREATE TABLE external_links (
    crawl_id   TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    status     INTEGER,
    error      TEXT,
    final_url  TEXT,
    PRIMARY KEY (crawl_id, url)
  );
  `,
  // 2: analysis results
  `
  ALTER TABLE crawls ADD COLUMN analyzed_at TEXT;

  CREATE TABLE page_metrics (
    page_id           INTEGER PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
    crawl_id          TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    indexable         INTEGER NOT NULL,
    inlinks           INTEGER NOT NULL,
    unique_inlinks    INTEGER NOT NULL,
    main_inlinks      INTEGER NOT NULL,
    outlinks          INTEGER NOT NULL,
    external_outlinks INTEGER NOT NULL,
    unique_anchors    INTEGER NOT NULL,
    click_depth       INTEGER,
    pagerank          REAL
  );
  CREATE INDEX page_metrics_crawl ON page_metrics (crawl_id);

  CREATE TABLE issues (
    crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    count    INTEGER NOT NULL,
    PRIMARY KEY (crawl_id, check_id)
  );

  CREATE TABLE issue_items (
    id       INTEGER PRIMARY KEY,
    crawl_id TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    url      TEXT NOT NULL,
    detail   TEXT
  );
  CREATE INDEX issue_items_check ON issue_items (crawl_id, check_id);
  CREATE INDEX issue_items_url ON issue_items (crawl_id, url);
  `,
  // 3: templates and PageSpeed Insights
  `
  ALTER TABLE pages ADD COLUMN dom_signature BLOB;

  CREATE TABLE templates (
    id                INTEGER PRIMARY KEY,
    crawl_id          TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    pattern           TEXT NOT NULL,
    variant           INTEGER NOT NULL,
    page_count        INTEGER NOT NULL,
    ttfb_median       REAL,
    ttfb_p90          REAL,
    download_median   REAL,
    html_bytes_median INTEGER,
    word_count_median INTEGER,
    representatives_json TEXT NOT NULL
  );
  CREATE INDEX templates_crawl ON templates (crawl_id);

  CREATE TABLE psi_results (
    id                INTEGER PRIMARY KEY,
    crawl_id          TEXT NOT NULL REFERENCES crawls (id) ON DELETE CASCADE,
    template_id       INTEGER REFERENCES templates (id) ON DELETE SET NULL,
    url               TEXT NOT NULL,
    strategy          TEXT NOT NULL,
    measured_at       TEXT NOT NULL,
    performance_score REAL,
    lcp_ms            REAL,
    cls               REAL,
    tbt_ms            REAL,
    fcp_ms            REAL,
    total_bytes       INTEGER,
    field_json        TEXT,
    error             TEXT
  );
  CREATE INDEX psi_results_crawl ON psi_results (crawl_id, url, strategy);
  `,
];

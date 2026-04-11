/**
 * Sample arxiv Atom XML with 3 entries for reuse by adapter and
 * enricher tests. Each entry is a plausible fintech/ML paper so the
 * downstream enricher + tests can exercise category selection and
 * recency scoring without hitting the real API.
 */
export const SAMPLE_ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2601.12345v1</id>
    <title>Sample Paper: Adversarial Fraud Detection</title>
    <summary>We propose a new method for detecting synthetic fraud using adversarial ML.</summary>
    <published>2026-03-14T12:00:00Z</published>
    <updated>2026-03-14T12:00:00Z</updated>
    <category term="cs.LG"/>
    <category term="cs.CR"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2602.67890v2</id>
    <title>Sample Paper: Anomaly Detection for Payments</title>
    <summary>A survey of anomaly detection techniques in payments fraud.</summary>
    <published>2026-02-20T09:30:00Z</published>
    <updated>2026-03-01T11:00:00Z</updated>
    <category term="cs.LG"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2603.11111v1</id>
    <title>Sample Paper: Risk Scoring at Scale</title>
    <summary>Distributed systems for real-time risk scoring.</summary>
    <published>2026-03-10T15:00:00Z</published>
    <updated>2026-03-10T15:00:00Z</updated>
    <category term="cs.DC"/>
  </entry>
</feed>`;

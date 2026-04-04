import { useState } from 'react'

const seedFeed = [
  {
    id: '1',
    headline: 'GPU / accelerator supply & leasing',
    note: 'Track hyperscaler capex guides, foundry ramps, and resale premiums.',
    status: 'Watch',
  },
  {
    id: '2',
    headline: 'Power & interconnection',
    note: 'Grid queues, PPA pricing, and AI cluster backhaul constraints.',
    status: 'Active',
  },
  {
    id: '3',
    headline: 'Cooling & facility design',
    note: 'Liquid cooling adoption, PUE trends, and retrofit timelines.',
    status: 'Watch',
  },
]

export default function App() {
  const [lastBuilt] = useState(() => new Date().toISOString())

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-mark" aria-hidden>
            ⚡
          </span>
          <div>
            <h1 className="app-title">Faraday</h1>
            <p className="app-tagline">Data center intelligence dashboard</p>
          </div>
        </div>
        <p className="app-meta">
          Static build {lastBuilt.slice(0, 19).replace('T', ' ')} UTC — replace
          this bundle on your host after each upload.
        </p>
      </header>

      <main className="app-main">
        <section className="panel">
          <h2 className="panel-title">Market grid</h2>
          <p className="panel-lede">
            Curated themes for AI infrastructure and data center supply chains.
            Wire live data or API feeds here when your backend is ready.
          </p>
          <ul className="feed">
            {seedFeed.map((item) => (
              <li key={item.id} className="feed-row">
                <div>
                  <p className="feed-headline">{item.headline}</p>
                  <p className="feed-note">{item.note}</p>
                </div>
                <span className={`feed-pill feed-pill--${item.status.toLowerCase()}`}>
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

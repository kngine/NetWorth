# NetWorth

A Progressive Web App to track your net worth over time. Robinhood-inspired dark UI. No build step—plain HTML, CSS, and JavaScript.

## Features

- **Add sections** – Each section has account name, asset type (Cash, Stock, Real Estate, Bonds, Crypto, Retirement, Other), value ($), and debt ($).
- **Total Net Worth** – Shown at the top; updates as you edit sections.
- **Save snapshots** – Save the current total and date (default: today; date is editable). Each save stores amount and date.
- **Current / History** – Switch between:
  - **Current** – Edit sections and save snapshots.
  - **History** – Chart and list of saved net worth over time.
- **Local storage** – All sections and snapshots are stored in your browser only.

- **Stock type** – For Stock assets, enter a ticker (e.g. AAPL) and number of shares. Value is auto-computed from live prices via Yahoo Finance (no API key needed). Tap ↻ to refresh.

## Run locally

Open `index.html` in a browser, or use any simple static server:

```bash
# Python
python3 -m http.server 8000

# Then open http://localhost:8000
```

## Deploy to Netlify

1. Push this folder to a Git repo (GitHub, GitLab, or Bitbucket).
2. In [Netlify](https://netlify.com): **Add new site** → **Import from Git**.
3. Select your repo. Netlify will detect it as a static site (no build).
4. Click **Deploy**.

Or drag-and-drop the folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

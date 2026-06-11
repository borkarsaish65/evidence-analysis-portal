# Evidence Analysis Portal

React frontend for the Evidence Analysis System.

---

## Prerequisites

- Node.js 20+ and npm 10+
- Backend API running at `http://localhost:6002`

---

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Start development server
npm run dev
```

Portal is available at http://localhost:5173.

---

## Environment Variables

All configuration is driven by `.env`. See `.env.example` for the full list.

Minimum required:
```env
APPLICATION_PORT=5173
API_ENDPOINT=http://localhost:6002
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build production bundle to `dist/` |
| `npm run lint` | Run ESLint |

---

## Map Assets

District map files live in `public/maps/states`. To regenerate from the DataMeet district shapefile:

```bash
mkdir -p /tmp/datameet-districts
curl -L https://raw.githubusercontent.com/datameet/maps/master/Districts/Census_2011/2011_Dist.shp \
  -o /tmp/datameet-districts/2011_Dist.shp
curl -L https://raw.githubusercontent.com/datameet/maps/master/Districts/Census_2011/2011_Dist.dbf \
  -o /tmp/datameet-districts/2011_Dist.dbf
npm run prepare:maps -- --shp /tmp/datameet-districts/2011_Dist.shp \
  --dbf /tmp/datameet-districts/2011_Dist.dbf
```

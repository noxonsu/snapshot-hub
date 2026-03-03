# snapshot-hub Integration Guide

Универсальное Web3-хранилище с криптографической гарантией целостности данных.

Данные хранятся в PostgreSQL, подписаны приватным ключом пользователя через EIP-712.
Подделать или изменить запись без ключа невозможно — hub проверяет `ecrecover`.

**Сервер:** `http://localhost:3700` (VM104, pm2: `snapshothub`)
**DB:** `postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb`

---

## Концепция

```
User action (bid, vote, trade)
    ↓
Frontend: собирает payload (marketId, price, amount, txHash...)
    ↓
Wallet: EIP-712 signTypedData() → signature
    ↓
POST /api/msg { msg, address, sig }
    ↓
snapshot-hub: ecrecover(sig) → проверяет address → writer.verify() → writer.action() → PostgreSQL
    ↓
GraphQL: { orders(where: { space: "myapp.wpmix.net" }) { ... } }
```

Каждый продукт имеет свой `space` (домен). Данные изолированы по домену.

---

## Шаг 1. Зарегистрировать space

Space — строковый идентификатор продукта (домен или slug). Регистрируется один раз при деплое.

```bash
# Прямая вставка в PostgreSQL (без ENS)
psql postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb << 'SQL'
INSERT INTO spaces (id, name, settings, created)
VALUES (
  'myapp.wpmix.net',
  'My App',
  '{"name":"My App","network":"97","strategies":[],"admins":[]}',
  NOW()
)
ON CONFLICT (id) DO NOTHING;
SQL

# Или через готовый скрипт (пример в PolyFactory):
node scripts/register-snapshot-space.js myapp.wpmix.net "My App"
```

Перезагрузить кеш пространств в hub:
```bash
curl -s http://localhost:3700/poke
```

---

## Шаг 2. Добавить тип данных (если нужен новый)

Уже поддерживаемые типы:
- `order` — CLOB ордер (PolyFactory)
- `proposal` — предложение (DAOwidget)
- `vote` — голос (DAOwidget)

Чтобы добавить новый тип (например `trade` для DEX):

### 2.1 Определить EIP-712 типы

```typescript
// src/writer/trade.ts
const TRADE_TYPES = {
  Trade: [
    { name: 'from',       type: 'address' },
    { name: 'space',      type: 'string'  },
    { name: 'timestamp',  type: 'uint64'  },
    { name: 'tokenIn',    type: 'string'  },
    { name: 'tokenOut',   type: 'string'  },
    { name: 'amountIn',   type: 'string'  },
    { name: 'amountOut',  type: 'string'  },
    { name: 'txHash',     type: 'string'  },
    { name: 'network',    type: 'string'  },
  ]
};
```

### 2.2 Вычислить hash типов и зарегистрировать в ingestor

```bash
node -e "
const crypto = require('crypto');
const TRADE_TYPES = { Trade: [
  { name: 'from', type: 'address' },
  // ... все поля
]};
console.log(crypto.createHash('sha256').update(JSON.stringify(TRADE_TYPES)).digest('hex'));
"
# → например: ab12cd34ef56...
```

В `src/ingestor/typedData/index.ts` добавить:
```typescript
const TRADE_TYPES_HASH = 'ab12cd34ef56...'; // результат выше

// В функции resolveType():
if (hash === TRADE_TYPES_HASH) return { type: 'trade', types: TRADE_TYPES };
```

### 2.3 Создать writer

```typescript
// src/writer/trade.ts
import { addOrGetSpace } from '../helpers/adapters/mysql';

export async function verify(body): Promise<void> {
  const msg = typeof body.msg === 'string' ? JSON.parse(body.msg) : body.msg;
  const payload = msg.payload ?? msg;
  if (!payload.txHash?.trim()) throw 'missing txHash';
  if (!payload.tokenIn?.trim()) throw 'missing tokenIn';
  if (String(payload.network) !== '97') throw 'wrong network';
}

export async function action(body, ipfs): Promise<void> {
  const msg = typeof body.msg === 'string' ? JSON.parse(body.msg) : body.msg;
  const payload = msg.payload ?? msg;
  // INSERT в свою таблицу
  await pool.query(
    `INSERT INTO trades (id, voter, space, token_in, token_out, amount_in, amount_out, tx_hash, network, timestamp, created)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [ipfs, body.address, msg.space, payload.tokenIn, payload.tokenOut,
     payload.amountIn, payload.amountOut, payload.txHash, payload.network,
     msg.timestamp]
  );
}
```

### 2.4 Зарегистрировать writer в ingestor

```typescript
// src/ingestor/index.ts — добавить в writers map:
import * as trade from '../writer/trade';
const writers = { proposal, vote, settings, alias, order, trade };
```

---

## Шаг 3. Фронтенд интеграция (ethers v6)

### Подписать и отправить ордер

```javascript
// snapshot-storage.js — скопировать в свой проект или взять из PolyFactory

const SNAPSHOT_HUB_URL = window.MyApp_?.SNAPSHOT_HUB_URL ?? 'http://localhost:3700';
const SNAPSHOT_SPACE   = window.MyApp_?.SNAPSHOT_SPACE   ?? 'myapp.wpmix.net';

const ORDER_TYPES = {
  Order: [
    { name: 'from',      type: 'address' },
    { name: 'space',     type: 'string'  },
    { name: 'timestamp', type: 'uint64'  },
    { name: 'marketId',  type: 'string'  },
    { name: 'side',      type: 'string'  },
    { name: 'price',     type: 'string'  },
    { name: 'amount',    type: 'string'  },
    { name: 'txHash',    type: 'string'  },
    { name: 'network',   type: 'string'  },
  ]
};

const ORDER_DOMAIN = {
  name: 'snapshot',
  version: '0.1.4',
};

async function snapshotSignAndSubmit(signer, payload) {
  const from      = await signer.getAddress();
  const timestamp = String(Math.floor(Date.now() / 1000));

  const msg = {
    version: '0.1.4',
    timestamp,
    space: SNAPSHOT_SPACE,
    type: 'order',
    payload,
  };

  // ethers v6: signer.signTypedData(domain, types, value)
  const sig = await signer.signTypedData(ORDER_DOMAIN, ORDER_TYPES, {
    from,
    space:     SNAPSHOT_SPACE,
    timestamp: BigInt(timestamp),
    marketId:  String(payload.marketId),
    side:      String(payload.side),
    price:     String(payload.price),
    amount:    String(payload.amount),
    txHash:    payload.txHash,
    network:   String(payload.network ?? 97),
  });

  const res = await fetch(`${SNAPSHOT_HUB_URL}/api/msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg: JSON.stringify(msg), address: from, sig }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`snapshot-hub error: ${err}`);
  }
  return res.json();
}
```

### Читать ордера через GraphQL

```javascript
async function loadOrdersFromHub(space, voter = null, first = 50) {
  const whereClause = voter
    ? `where: { space: "${space}", voter: "${voter}" }`
    : `where: { space: "${space}" }`;

  const query = `{
    orders(first: ${first}, ${whereClause}) {
      id
      voter
      space
      marketId
      side
      price
      amount
      txHash
      network
      timestamp
    }
  }`;

  const res = await fetch(`${SNAPSHOT_HUB_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { data } = await res.json();
  return data?.orders ?? [];
}
```

### Интегрировать в action (fire-and-forget)

```javascript
// После onchain транзакции — не блокировать UI
async function placeOrderAction(marketId, side, price, amount) {
  // 1. Onchain транзакция
  const tx = await marketContract.placeOrder(marketId, side, price, amount);
  const receipt = await tx.wait();

  showToast('Order placed on-chain!', 'success');

  // 2. Записать в snapshot-hub (fire-and-forget)
  snapshotSignAndSubmit(signer, {
    marketId: String(marketId),
    side:     String(side),
    price:    String(price),
    amount:   String(amount),
    txHash:   receipt.hash,
    network:  '97',
  }).catch(err => console.warn('[snapshot] save failed (non-critical):', err));
}
```

---

## Шаг 4. Конфигурация через window.*_

Продукты получают URL и space через глобальный объект — это позволяет встраивать их как виджеты:

```html
<!-- Хост-страница задаёт конфиг до загрузки скрипта -->
<script>
  window.PolyFactory_ = {
    SNAPSHOT_HUB_URL: 'http://localhost:3700',
    SNAPSHOT_SPACE:   'polyfactory.wpmix.net',
  };
</script>
<script src="app.js?v=11"></script>
```

В `app.js` / `snapshot-storage.js`:
```javascript
const HUB_URL = window.PolyFactory_?.SNAPSHOT_HUB_URL ?? 'http://localhost:3700';
const SPACE   = window.PolyFactory_?.SNAPSHOT_SPACE   ?? 'polyfactory.wpmix.net';
```

Если `window.PolyFactory_` не задан — используются дефолты (наш hub + наш домен).

---

## API Reference

### POST /api/msg

Принять подписанное сообщение.

```
POST http://localhost:3700/api/msg
Content-Type: application/json

{
  "msg": "{\"version\":\"0.1.4\",\"timestamp\":\"1700000000\",\"space\":\"myapp.wpmix.net\",\"type\":\"order\",\"payload\":{...}}",
  "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "sig": "0x..."
}
```

**Ответы:**
- `200 OK` — сохранено
- `400` — ошибка валидации (тело = текст ошибки)
- `500` — внутренняя ошибка

### GraphQL /graphql

```graphql
# Все ордера по space
{
  orders(first: 50, where: { space: "polyfactory.wpmix.net" }) {
    id voter marketId side price amount txHash timestamp
  }
}

# Ордера конкретного пользователя
{
  orders(first: 20, where: { voter: "0x123...", space: "polyfactory.wpmix.net" }) {
    id marketId side price amount txHash
  }
}

# Один ордер по id (ipfs hash)
{
  order(id: "Qm...") {
    id voter marketId txHash
  }
}
```

### GET /api

```
GET http://localhost:3700/api
→ { "name": "snapshot-hub", "version": "0.1.4" }
```

### GET /poke

Принудительно перезагрузить кеш spaces из БД (нужно после регистрации нового space):
```
GET http://localhost:3700/poke
```

---

## Пример: полный цикл для нового продукта

```bash
# 1. Зарегистрировать space
psql postgresql://snaphub:snaphub_pass_2026@localhost:5432/snapshotdb \
  -c "INSERT INTO spaces (id, name, settings, created) VALUES ('farm.wpmix.net', 'FarmFactory', '{\"network\":\"97\"}', NOW()) ON CONFLICT DO NOTHING;"

curl http://localhost:3700/poke

# 2. Проверить регистрацию
curl -s -X POST http://localhost:3700/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ orders(first: 1, where: { space: \"farm.wpmix.net\" }) { id } }"}'
# → {"data":{"orders":[]}}

# 3. Запустить интеграционные тесты
cd /root/snapshot-hub
INTEGRATION=1 SNAPSHOT_HUB_URL=http://localhost:3700 npm run test:integration
```

---

## Тесты

```bash
# Unit тесты (в CI, без сервера):
npm run test:unit

# Интеграционные тесты (локально, нужен запущенный сервер):
INTEGRATION=1 npm run test:integration

# Все тесты:
npm test
```

Файлы тестов:
- `test/order.test.js` — unit тесты verify-логики, хэш-консистентность, ingestor
- `test/api.integration.test.js` — HTTP + GraphQL интеграционные тесты

---

## Чеклист подключения нового продукта

- [ ] Создать space в PostgreSQL + `/poke`
- [ ] Скопировать `snapshot-storage.js` из PolyFactory (`/root/PolyFactory/frontend/snapshot-storage.js`)
- [ ] Задать `window.MyApp_.SNAPSHOT_HUB_URL` и `SNAPSHOT_SPACE` на хост-странице
- [ ] После onchain действия вызвать `snapshotSignAndSubmit(signer, payload)` fire-and-forget
- [ ] Для чтения использовать `loadOrdersFromHub(space, voter)` через GraphQL
- [ ] Добавить `INTEGRATION=1 npm run test:integration` в локальный smoke-test

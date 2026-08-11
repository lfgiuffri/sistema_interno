# Zero Backend

![Zero](https://img.shields.io/badge/Zero-Backend-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![Express](https://img.shields.io/badge/Express-4.18+-lightgrey.svg)
![MySQL](https://img.shields.io/badge/MySQL-8.0+-orange.svg)
![MariaDB](https://img.shields.io/badge/MariaDB-10.11+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

API REST multi-tenant para **Zero** — asistente personal inteligente. Incluye autenticación JWT, autorización granular basada en roles, chat con IA (OpenAI GPT-4o), finanzas, tareas, recordatorios, listas, ubicaciones, push notifications (FCM), real-time con Socket.IO y más.

## Características principales

### Arquitectura multi-tenant
- Aislamiento total de datos con bases de datos separadas por tenant
- Creación automática de tenants con configuración completa
- Gestión centralizada desde API maestra
- Planes flexibles (Basic, Premium, Enterprise) con límites configurables
- Conexiones optimizadas con cache inteligente y pooling

### Autenticación y autorización
- Autenticación JWT con refresh tokens
- Login maestro: un solo endpoint para todos los tenants (`/master/auth/signin`)
- Rate limiting inteligente por endpoint y usuario
- Roles y permisos granulares configurables por vista
- Action tracking completo para auditoría

### Módulo Zero (asistente personal)
- **Chat IA**: Interpretación de intents con GPT-4o (35 intents), análisis de tickets con Vision, transcripción de audio con Whisper
- **Finanzas**: Gastos, ingresos, cuentas (6 tipos), transferencias, reconciliación, gastos fijos recurrentes, presupuestos por categoría
- **Tareas**: CRUD con prioridad, subtareas, estados, fecha de vencimiento, ubicación asociada
- **Recordatorios**: Por tiempo, ubicación o recurrentes, con push notifications inteligentes
- **Listas de compras**: Listas con ítems, checkbox, progreso
- **Ubicaciones**: Coordenadas con radio de geofencing
- **Cotización dólar**: Integración con dolarapi.com (blue, oficial, tarjeta, cripto, mayorista)
- **Push notifications**: Firebase Cloud Messaging con horarios silenciosos y DND
- **Real-time**: Socket.IO para sincronización instantánea entre dispositivos

### Sistema base (heredado de Zero)
- Gestión avanzada de usuarios con roles y permisos
- Sistema de configuración dinámica (global y por tenant)
- Arquitectura modular con auto-discovery de modelos
- Response manager centralizado

## Estructura del proyecto

```
backend/
├── src/
│   ├── app.js                    # Configuración Express
│   ├── index.js                  # Entry point + Socket.IO server
│   ├── routes.js                 # Rutas centralizadas
│   ├── masterDatabase.js         # Conexión BD maestra
│   ├── masterAssociations.js     # Auto-discovery modelos master
│   ├── tenantAssociations.js     # Auto-discovery modelos tenant
│   │
│   ├── exec/                     # Scripts de inicialización
│   │   ├── initMasterDb.js
│   │   ├── getApiKey.js
│   │   └── data/                 # Datos iniciales JSON
│   │       ├── GlobalConfigs.json
│   │       ├── Configs.json
│   │       ├── Views.json
│   │       ├── Routes.json
│   │       └── ParentViews.json
│   │
│   ├── libs/                     # Utilidades
│   │   ├── responseManager.js    # Respuestas estandarizadas
│   │   ├── paginate.js           # Paginación
│   │   ├── multer.js             # Upload de archivos por tenant
│   │   ├── timestamp.js          # Fecha/hora ISO
│   │   ├── loadJSONData.js       # Carga de datos JSON
│   │   ├── getIp.js              # IP del cliente
│   │   └── promiseUtils.js       # Utilidades async
│   │
│   ├── middlewares/
│   │   ├── index.js              # Exportación centralizada
│   │   ├── tenantMiddleware.js   # Identificación de tenants (x-api-key)
│   │   ├── rateLimit.js          # Rate limiting
│   │   ├── verifyAccessToken.js  # Verificación JWT
│   │   ├── verifyPermissions.js  # Control de permisos por vista
│   │   ├── actionTracking.js     # Seguimiento de acciones
│   │   └── validator.js          # Validación express-validator
│   │
│   ├── modules/
│   │   ├── master/               # Módulo maestro (admin)
│   │   │   ├── models/
│   │   │   │   ├── Tenant.js
│   │   │   │   ├── GlobalConfig.js
│   │   │   │   └── MasterUser.js
│   │   │   ├── controllers/
│   │   │   │   ├── tenants.controller.js
│   │   │   │   ├── globalConfigs.controller.js
│   │   │   │   └── auth.controller.js
│   │   │   ├── routes/
│   │   │   └── validators/
│   │   │
│   │   ├── core/                 # Módulo del sistema
│   │   │   ├── models/
│   │   │   │   ├── Config.js
│   │   │   │   ├── Module.js
│   │   │   │   ├── Controller.js
│   │   │   │   ├── View.js
│   │   │   │   ├── ParentView.js
│   │   │   │   ├── Route.js
│   │   │   │   ├── ActionTracking.js
│   │   │   │   └── NotificationLog.js
│   │   │   ├── controllers/
│   │   │   ├── routes/
│   │   │   └── validators/
│   │   │
│   │   ├── users/                # Módulo de usuarios
│   │   │   ├── models/
│   │   │   │   ├── User.js
│   │   │   │   ├── Role.js
│   │   │   │   └── Permission.js
│   │   │   ├── controllers/
│   │   │   │   ├── auth.controller.js
│   │   │   │   ├── users.controller.js
│   │   │   │   └── roles.controller.js
│   │   │   ├── routes/
│   │   │   └── validators/
│   │   │
│   │   └── zero/             # Módulo Zero (asistente)
│   │       ├── models/
│   │       │   ├── Account.js          # ls_accounts
│   │       │   ├── Expense.js          # ls_expenses
│   │       │   ├── Task.js             # ls_tasks
│   │       │   ├── Reminder.js         # ls_reminders
│   │       │   ├── ShoppingList.js     # ls_shopping_lists
│   │       │   ├── ShoppingListItem.js # ls_shopping_list_items
│   │       │   ├── UserLocation.js     # ls_user_locations
│   │       │   ├── RecurringExpense.js # ls_recurring_expenses
│   │       │   ├── Message.js          # ls_messages
│   │       │   ├── Budget.js           # ls_budgets
│   │       │   └── UserSettings.js     # ls_user_settings
│   │       ├── controllers/
│   │       │   ├── expenses.controller.js
│   │       │   ├── accounts.controller.js
│   │       │   ├── tasks.controller.js
│   │       │   ├── reminders.controller.js
│   │       │   ├── lists.controller.js
│   │       │   ├── locations.controller.js
│   │       │   ├── recurringExpenses.controller.js
│   │       │   ├── budgets.controller.js
│   │       │   ├── ai.controller.js
│   │       │   ├── messages.controller.js
│   │       │   ├── settings.controller.js
│   │       │   └── dollar.controller.js
│   │       ├── routes/
│   │       │   └── index.js            # Barrel con scheduler middleware
│   │       ├── services/
│   │       │   ├── openai.service.js   # GPT-4o + Whisper + Vision
│   │       │   ├── push.service.js     # FCM + horarios silenciosos
│   │       │   ├── dollar.service.js   # dolarapi.com con cache
│   │       │   ├── scheduler.service.js# Recordatorios por tenant
│   │       │   └── helpers.js          # Categorías, emojis, shortId
│   │       └── validators/
│   │
│   └── services/                 # Servicios externos
│
├── public/                       # Archivos públicos por tenant
├── API Rest/                     # Documentación HTTP
├── docs/
├── package.json
├── pm2.config.js
└── .env.example
```

## Tecnologías

| Categoría | Tecnologías |
|-----------|-------------|
| **Runtime** | Node.js 18+, Babel (ES modules) |
| **Framework** | Express 4.18 |
| **ORM** | Sequelize 6.30 (MySQL / MariaDB) |
| **Auth** | JWT, bcryptjs |
| **Real-time** | Socket.IO 4.8 |
| **IA** | OpenAI 4.76 (GPT-4o, Whisper, Vision) |
| **Push** | Firebase Admin 13 (FCM) |
| **Seguridad** | Helmet, CORS, express-rate-limit |
| **Validación** | express-validator |
| **Upload** | Multer |
| **Logging** | Morgan |

## Instalación

### Requisitos
- Node.js 18+
- MariaDB 10.11+ o MySQL 8.0+
- Cuenta OpenAI (API key)
- Firebase project (para push nativo, opcional)

### Setup

```bash
cd backend
cp .env.example .env    # completar con valores reales
npm install
npm run init_master_db  # crea la base maestra
npm run dev             # arranca en http://localhost:3010
```

### Producción

```bash
npm run build
npm start
# o con PM2:
pm2 start pm2.config.js
```

## Variables de entorno

```env
PORT=3010
NODE_ENV=development
TIMEZONE=America/Argentina/Buenos_Aires

# JWT
JWT_SECRET=secret-seguro
JWT_REFRESH_SECRET=otro-secret
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Base de datos maestra
MASTER_DBHOST=localhost
MASTER_DBNAME=zero2_master
MASTER_DBUSER=root
MASTER_DBPASS=password
DBDRIVER=mariadb

# Admin por defecto
ADMINUSER=admin
ADMINPASS=admin123

# OpenAI
OPENAI_API_KEY=sk-...

# Firebase (push)
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json

```

## API Endpoints

### Master (administración)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/master/auth/signin` | Login maestro (todos los tenants) |
| `POST` | `/api/master/tenants` | Crear tenant |
| `GET` | `/api/master/tenants` | Listar tenants |
| `POST` | `/api/master/tenants/sync` | Sincronizar tenant |
| `GET` | `/api/master/global-configs` | Listar configs globales |
| `PUT` | `/api/master/global-configs/:name` | Actualizar config |

### Auth (tenant)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/users/auth/signin` | Login de tenant |
| `GET` | `/api/users/auth/currentuser` | Usuario actual |

### Zero (requiere JWT)

| Recurso | Endpoints | Descripción |
|---------|-----------|-------------|
| **Expenses** | `GET/POST/PUT/DELETE /api/expenses` | Gastos e ingresos |
| **Accounts** | `GET/POST/PUT/DELETE /api/accounts` | Cuentas + transfer + reconcile |
| **Tasks** | `GET/POST/PUT/DELETE /api/tasks` | Tareas con subtareas |
| **Reminders** | `GET/POST/PUT/DELETE /api/reminders` | Recordatorios + snooze |
| **Lists** | `GET/POST/PUT/DELETE /api/lists` | Listas de compras + items |
| **Locations** | `GET/POST/PUT/DELETE /api/locations` | Ubicaciones guardadas |
| **Recurring** | `GET/POST/PUT/DELETE /api/recurring-expenses` | Gastos fijos + registro |
| **Budgets** | `GET/POST/PUT/DELETE /api/budgets` | Presupuestos por categoría |
| **AI** | `POST /api/ai/interpret` | Interpretar mensaje con IA |
| **AI** | `POST /api/ai/transcribe` | Transcribir audio (Whisper) |
| **AI** | `POST /api/ai/analyze-receipt` | Analizar ticket (Vision) |
| **Messages** | `GET/DELETE /api/messages` | Historial de chat |
| **Settings** | `GET/PUT /api/settings` | Config del usuario |
| **Dollar** | `GET /api/dollar/rates` | Cotización del dólar |

### Socket.IO Events

Conexión con auth JWT. Emite eventos en tiempo real:

```
expense:created/updated/deleted
account:created/updated
task:created/updated/deleted
reminder:created/updated/deleted/triggered
recurringExpense:created/updated/deleted
budget:created/updated/deleted
list:created/updated/deleted
listItem:created/updated/deleted
```

## Scripts

```bash
npm run dev            # Desarrollo con nodemon
npm run build          # Build con Babel
npm start              # Producción
npm run init_master_db # Inicializar BD maestra
npm run get_api_key    # Obtener API key de tenant
```

## Arquitectura

### Flujo de request
1. Rate Limiting → 2. Tenant Identification (x-api-key o JWT) → 3. Authentication (JWT) → 4. Authorization (permisos) → 5. Validation → 6. Controller → 7. Response Manager

### Multi-tenant
- **Master DB**: Tenants, GlobalConfigs, MasterUsers
- **Tenant DB**: Una por tenant, modelos auto-descubiertos desde `modules/*/models/`
- **Conexiones**: Cache con pooling, limpieza automática

### Scheduler (recordatorios)
- Inicialización lazy por tenant (se activa al primer request)
- Chequeo de recordatorios vencidos cada 60 segundos
- Push notification + emit Socket.IO al usuario
- Respeta horarios silenciosos y DND

## Licencia

MIT

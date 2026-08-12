import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // frontend served separately
    crossOriginEmbedderPolicy: false,
  }),
);

// Global rate limiting: 300 req/min por IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Muitas requisições. Tente novamente em um minuto." },
  }),
);

// Strict rate limiting for auth-adjacent endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Limite de tentativas atingido. Tente novamente em 15 minutos." },
});
app.use("/api/phishing/track", strictLimiter);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigin =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_BASE_URL?.replace(/\/$/, "") || false
    : true;
app.use(cors({ credentials: true, origin: allowedOrigin }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Public phishing tracking routes must bypass Clerk to avoid __clerk_handshake redirect loops
// clerkMiddleware() must be instantiated ONCE, not per-request
const PUBLIC_PHISHING_RE = /^\/api\/phishing\/(track|training)\//;  // report-email is under /track/
const clerkMw = clerkMiddleware();
app.use((req, res, next) => {
  if (PUBLIC_PHISHING_RE.test(req.path)) return next();
  return clerkMw(req, res, next);
});

app.use("/api", router);

app.use((_req, res) => {
  res.redirect(301, "https://wnrtecnologia.com.br/wnraudit/app/");
});

export default app;

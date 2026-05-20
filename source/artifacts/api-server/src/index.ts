import app from "./app";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/ensureSchema";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function start() {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Roda o bootstrap de schema em background, depois que a porta já abriu.
    // Se o banco estiver indisponível no momento do deploy, o servidor ainda
    // sobe (autoscale considera saudável) e as rotas que dependem do banco
    // retornarão 5xx até o banco voltar.
    ensureSchema().catch((schemaErr) => {
      logger.error(
        { err: schemaErr },
        "ensureSchema falhou no boot — servidor segue rodando, rotas que usam o banco podem falhar até o banco voltar",
      );
    });
  });
}

try {
  start();
} catch (err) {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
}

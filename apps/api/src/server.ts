import { appConfig } from "./config.js";
import app from "./app.js";
import { verifyDatabaseConnection } from "./db.js";

app.listen(appConfig.port, async () => {
  console.log(`GrizCam API running on http://localhost:${appConfig.port}`);
  await verifyDatabaseConnection();
});

import app from './api/apiSetup';
import { config } from './api/index';

const port = config.port || 5000;
app.listen(port, () => {
  /* eslint-disable no-console */
  console.log(`Listening: http://localhost:${port}`);
  /* eslint-enable no-console */
});

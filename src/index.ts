import app from './api/apiSetup';
import { config } from './api/config';

const port = config.port || 5000;
app.listen(port, () => {
  /* eslint-disable no-console */
  console.log(`Listening: http://localhost:${port}`);
  /* eslint-enable no-console */
});

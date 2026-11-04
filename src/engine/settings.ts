// Setting keys (contributed in package.json). Kept separate from the editor adapters so pure
// modules can use them without loading the Python extension facade.
export const SETTING_SECTION = 'hearback';
export const PYTHON_PATH_KEY = 'engine.pythonPath';
export const PYTHON_PATH_SETTING = `${SETTING_SECTION}.${PYTHON_PATH_KEY}`;
export const TIMEOUT_KEY = 'engine.timeoutMs';

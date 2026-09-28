class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

module.exports = { HttpError, clean };

export function ErrorMessage({ text }) {
  return text ? <p className="error" role="alert">{text}</p> : null;
}

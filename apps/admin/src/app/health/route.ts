// Cloud Run reserves paths ending in "z" (/healthz never reaches the app there).
export { GET } from "../healthz/route";

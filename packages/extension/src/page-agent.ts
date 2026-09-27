// Main-world content script at document_start: hooks console/network early and answers the isolated overlay's
// questions about framework components, routes and state. It only ever answers about the page itself, so a hostile
// page gains nothing by faking it.
import { installAgent } from "../../overlay/src/agent.js";

installAgent();

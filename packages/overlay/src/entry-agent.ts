// Classic script injected first into <head> by the Vite plugin, so console/network hooks see early errors.
import { installAgent } from "./agent.js";

installAgent();

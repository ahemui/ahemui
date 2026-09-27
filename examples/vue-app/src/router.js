import { createRouter, createWebHistory } from "vue-router";
import HomePage from "./components/HomePage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomePage, meta: { title: "Home", section: "marketing" } },
    { path: "/pricing", name: "pricing", component: () => import("./components/PricingPage.vue"), meta: { title: "Pricing", section: "marketing" } },
  ],
});

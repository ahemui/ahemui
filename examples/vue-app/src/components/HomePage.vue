<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
const router = useRouter();
const stats = ref(null);
const loading = ref(false);

async function loadStats() {
  loading.value = true;
  const res = await fetch("/api/stats");
  if (!res.ok) console.error(`Failed to load stats: HTTP ${res.status}`);
  else stats.value = await res.json();
  loading.value = false;
}
</script>

<template>
  <section class="hero">
    <h1>Ship interfaces faster</h1>
    <p class="lead">Acme turns your rough ideas into polished product screens. No design degree required.</p>
    <div class="hero-actions">
      <button class="btn primary" @click="router.push('/pricing')">See pricing</button>
      <button class="btn">Book a demo</button>
      <button class="btn" @click="loadStats">{{ loading ? "Loading…" : "Load stats" }}</button>
    </div>
    <p class="faint">Stats: {{ stats ?? "not loaded" }}</p>
  </section>
  <section class="features">
    <div class="feature" v-for="f in features" :key="f.title">
      <h3>{{ f.title }}</h3>
      <p>{{ f.text }}</p>
    </div>
  </section>
  <section class="newsletter">
    <h2>Newsletter</h2>
    <form @submit.prevent>
      <input type="email" placeholder="you@example.com" value="jane.doe@example.com" />
      <button class="btn primary">Subscribe</button>
    </form>
    <p data-private>Signed in as jane.doe@example.com · account 4111 1111 1111 1111</p>
  </section>
</template>

<script>
const features = [
  { title: "Fast", text: "Hot reload everything, all the time." },
  { title: "Typed", text: "End-to-end types from database to button." },
  { title: "Friendly", text: "Readable errors that tell you what to do." },
];
export default { data: () => ({ features }) };
</script>

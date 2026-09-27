<script setup>
defineProps({ plan: Object });
</script>

<template>
  <article class="card" :class="{ featured: plan.featured }">
    <h2>{{ plan.name }}</h2>
    <p class="price">${{ plan.price }}<span>/mo</span></p>
    <ul>
      <li v-for="f in plan.features" :key="f">{{ f }}</li>
    </ul>
    <button class="btn" :class="{ primary: plan.featured, block: plan.featured }">
      {{ plan.featured ? "Start 14-day trial" : "Start free trial" }}
    </button>
  </article>
</template>

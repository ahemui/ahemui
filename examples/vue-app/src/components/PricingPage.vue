<script setup>
import PricingCard from "./PricingCard.vue";

const plans = [
  { name: "Hobby", price: 0, features: ["1 project", "Community support"] },
  { name: "Pro", price: 24, features: ["Unlimited projects", "Email support", "Custom domains"], featured: true },
  { name: "Team", price: 79, features: ["Everything in Pro", "SSO", "Audit log"] },
];
</script>

<template>
  <section class="pricing">
    <h1>Pricing</h1>
    <p class="lead">Simple plans. Cancel any time.</p>
    <div class="grid">
      <PricingCard v-for="plan in plans" :key="plan.name" :plan="plan" />
    </div>
  </section>
</template>

import { relations } from "drizzle-orm";

import { accounts, addresses, sessions, users } from "./auth";
import {
  categories,
  productImages,
  productVariants,
  products,
  reviews,
  wishlistItems,
} from "./catalog";
import {
  cartItems,
  carts,
  couponCategories,
  couponProducts,
  couponRedemptions,
  coupons,
  orderItems,
  orders,
  paymentEvents,
  payments,
  inventoryReservations,
} from "./commerce";

/**
 * Relaciones de Drizzle. Viven en su propio archivo por dos razones:
 *
 * 1. `relations()` es puramente declarativo para la query API (`db.query.*`);
 *    no genera SQL ni constraints. Los FK reales estan en las tablas.
 * 2. Concentrarlas aca evita imports circulares entre los modulos del schema:
 *    catalog no necesita conocer commerce ni al reves.
 *
 * Cuando hay DOS relaciones entre las mismas dos tablas (users <- reviews como
 * autor y como aprobador) hay que desambiguar con `relationName`, y el mismo
 * nombre debe repetirse en los dos lados.
 */

// --- Auth --------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  addresses: many(addresses),
  carts: many(carts),
  orders: many(orders),
  wishlistItems: many(wishlistItems),
  reviewsWritten: many(reviews, { relationName: "review_author" }),
  reviewsApproved: many(reviews, { relationName: "review_approver" }),
  couponRedemptions: many(couponRedemptions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

// --- Catalogo ----------------------------------------------------------------

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  /** Auto-referencia: hay que nombrar la relacion en los dos extremos. */
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_tree",
  }),
  children: many(categories, { relationName: "category_tree" }),
  products: many(products),
  coupons: many(couponCategories),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  variants: many(productVariants),
  images: many(productImages),
  reviews: many(reviews),
  wishlistItems: many(wishlistItems),
  orderItems: many(orderItems),
  coupons: many(couponProducts),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    cartItems: many(cartItems),
    orderItems: many(orderItems),
    reservations: many(inventoryReservations),
  }),
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  author: one(users, {
    fields: [reviews.userId],
    references: [users.id],
    relationName: "review_author",
  }),
  approver: one(users, {
    fields: [reviews.approvedBy],
    references: [users.id],
    relationName: "review_approver",
  }),
}));

export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  user: one(users, { fields: [wishlistItems.userId], references: [users.id] }),
  product: one(products, {
    fields: [wishlistItems.productId],
    references: [products.id],
  }),
}));

// --- Carrito -----------------------------------------------------------------

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

// --- Cupones -----------------------------------------------------------------

export const couponsRelations = relations(coupons, ({ many }) => ({
  categories: many(couponCategories),
  products: many(couponProducts),
  redemptions: many(couponRedemptions),
  orders: many(orders),
}));

export const couponCategoriesRelations = relations(
  couponCategories,
  ({ one }) => ({
    coupon: one(coupons, {
      fields: [couponCategories.couponId],
      references: [coupons.id],
    }),
    category: one(categories, {
      fields: [couponCategories.categoryId],
      references: [categories.id],
    }),
  }),
);

export const couponProductsRelations = relations(couponProducts, ({ one }) => ({
  coupon: one(coupons, {
    fields: [couponProducts.couponId],
    references: [coupons.id],
  }),
  product: one(products, {
    fields: [couponProducts.productId],
    references: [products.id],
  }),
}));

export const couponRedemptionsRelations = relations(
  couponRedemptions,
  ({ one }) => ({
    coupon: one(coupons, {
      fields: [couponRedemptions.couponId],
      references: [coupons.id],
    }),
    order: one(orders, {
      fields: [couponRedemptions.orderId],
      references: [orders.id],
    }),
    user: one(users, {
      fields: [couponRedemptions.userId],
      references: [users.id],
    }),
  }),
);

// --- Pedidos y pagos ---------------------------------------------------------

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  coupon: one(coupons, { fields: [orders.couponId], references: [coupons.id] }),
  items: many(orderItems),
  payments: many(payments),
  redemptions: many(couponRedemptions),
  reservations: many(inventoryReservations),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const inventoryReservationsRelations = relations(
  inventoryReservations,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [inventoryReservations.variantId],
      references: [productVariants.id],
    }),
    order: one(orders, {
      fields: [inventoryReservations.orderId],
      references: [orders.id],
    }),
  }),
);

/**
 * `payment_events` NO tiene relacion declarada con `payments` ni con `orders`.
 * Es a proposito: es una bitacora cruda de lo que mando la pasarela y se
 * escribe ANTES de saber a que pedido corresponde. El vinculo se resuelve
 * leyendo el payload dentro de fulfill_paid_order.
 */
export const paymentEventsRelations = relations(paymentEvents, () => ({}));

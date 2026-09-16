"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, ShoppingBag, UserRound, X } from "lucide-react";

import { MARCA, SITIO } from "@/lib/sitio";
import { ContadorCarrito } from "@/components/carrito/contador-carrito";
import { useCarrito } from "@/lib/stores/carrito";

type Categoria = { slug: string; nombre: string };

/**
 * Encabezado simple: marca, navegación de categorías y accesos a cuenta y
 * carrito. Sin franja de anuncios, texto en movimiento ni logo flotante: eso
 * era identidad de una tienda concreta, no parte del starter.
 */
export function Encabezado({ categorias }: { categorias: Categoria[] }) {
  const [abierto, setAbierto] = useState(false);
  const ruta = usePathname();
  const abrirCarrito = useCarrito((e) => e.abrirPanel);

  const nav = [
    ...categorias.map((c) => ({ href: `/${c.slug}/`, nombre: c.nombre, slug: c.slug })),
    { href: "/contactenos/", nombre: "Contacto", slug: "contactenos" },
  ];

  const esActiva = (slug: string) => ruta?.startsWith(`/${slug}`) ?? false;

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            aria-controls="menu-movil"
            className="rounded-lg p-2 transition-colors hover:bg-muted lg:hidden"
          >
            {abierto ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            <span className="solo-lectores">{abierto ? "Cerrar menú" : "Abrir menú"}</span>
          </button>

          <Link href="/" className="flex shrink-0 items-center gap-2">
            {MARCA.logo ? (
              <Image
                src={MARCA.logo}
                alt={SITIO.nombre}
                width={140}
                height={40}
                priority
                className="h-8 w-auto"
              />
            ) : (
              <span className="display text-lg">{SITIO.nombre}</span>
            )}
          </Link>
        </div>

        <nav aria-label="Categorías" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.href}
                  aria-current={esActiva(item.slug) ? "page" : undefined}
                  className={`rounded-full px-3 py-2 text-sm transition-colors hover:bg-muted ${
                    esActiva(item.slug) ? "bg-muted text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-1">
          <Link
            href="/mi-cuenta/"
            className="rounded-full p-2.5 transition-colors hover:bg-muted"
          >
            <UserRound className="size-5" aria-hidden />
            <span className="solo-lectores">Mi cuenta</span>
          </Link>

          <button
            type="button"
            onClick={abrirCarrito}
            className="relative rounded-full p-2.5 transition-colors hover:bg-muted"
          >
            <ShoppingBag className="size-5" aria-hidden />
            <span className="solo-lectores">Ver carrito</span>
            <ContadorCarrito />
          </button>
        </div>
      </div>

      {abierto && (
        <nav id="menu-movil" aria-label="Categorías" className="border-t bg-background lg:hidden">
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {nav.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.href}
                  onClick={() => setAbierto(false)}
                  className="block border-b py-3 text-sm last:border-0"
                >
                  {item.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

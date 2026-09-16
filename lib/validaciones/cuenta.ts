import { z } from "zod";

import { MAX_CONTRASENA, MIN_CONTRASENA } from "@/lib/auth/constantes";

/**
 * Validación de cuenta.
 *
 * El starter tenía los campos en el formulario pero ningún esquema: los
 * `onSubmit` hacían `preventDefault()` y nada más.
 */

const correo = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Escribe tu correo")
  .email("Revisa el correo, parece incompleto");

/**
 * Mínimo `MIN_CONTRASENA` caracteres, sin exigir mayúsculas ni símbolos.
 *
 * Las reglas de composición empujan a la gente hacia "Password1!", que es
 * peor que una frase larga. La longitud es lo que de verdad encarece un
 * ataque. Criterio del NIST SP 800-63B.
 *
 * `MAX_CONTRASENA` evita el DoS por hash: argon2 sobre una entrada de un
 * megabyte cuesta CPU real.
 */
const contrasena = z
  .string()
  .min(MIN_CONTRASENA, `Usa al menos ${MIN_CONTRASENA} caracteres. Una frase que recuerdes funciona bien.`)
  .max(MAX_CONTRASENA, "Demasiado larga");

export const esquemaEntrar = z.object({
  correo,
  // El máximo también aquí: el esquema de registro acota "para evitar el DoS
  // por hash", pero el login —que es la ruta que más se golpea— no lo hacía.
  // Una entrada de un megabyte no tiene por qué llegar nunca a argon2.
  contrasena: z.string().min(1, "Escribe tu contraseña").max(MAX_CONTRASENA, "Demasiado larga"),
});

export type DatosEntrar = z.infer<typeof esquemaEntrar>;

export const esquemaRegistro = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(3, "Escribe tu nombre completo")
      .max(120, "Demasiado largo"),
    correo,
    contrasena,
    confirmacion: z.string(),
  })
  .refine((d) => d.contrasena === d.confirmacion, {
    message: "Las contraseñas no coinciden",
    path: ["confirmacion"],
  });

export type DatosRegistro = z.infer<typeof esquemaRegistro>;

// ============================================================================
// Recuperación de contraseña
// ============================================================================

export const esquemaPedirEnlace = z.object({ correo });

export const esquemaCambiarContrasena = z
  .object({
    correo,
    // Va en un campo oculto del formulario; se acota para que no llegue basura
    // a la consulta.
    token: z.string().trim().min(20, "Enlace inválido").max(200, "Enlace inválido"),
    contrasena,
    confirmacion: z.string(),
  })
  .refine((d) => d.contrasena === d.confirmacion, {
    path: ["confirmacion"],
    message: "Las contraseñas no coinciden",
  });

export type DatosPedirEnlace = z.infer<typeof esquemaPedirEnlace>;
export type DatosCambiarContrasena = z.infer<typeof esquemaCambiarContrasena>;

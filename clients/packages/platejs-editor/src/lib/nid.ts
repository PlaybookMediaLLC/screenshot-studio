import { v4 as uuidv4 } from "uuid";

/**
 * Generates a unique identifier (UUID v4).
 *
 * This function generates a standard UUID v4 which is:
 *
 * - Cryptographically random
 * - Globally unique with extremely low collision probability
 * - Standard format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @example
 *   const id = nid(); // "123e4567-e89b-12d3-a456-426614174000"
 *
 * @returns {string} A UUID v4 string
 */
export const nid = (): string => uuidv4();

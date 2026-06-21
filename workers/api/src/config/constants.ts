/**
 * Constantes globales del API.
 *
 * DEFAULT_BRANCH_ID: ID de la sucursal por defecto cuando el cliente no provee
 * `branch_id` en query/body. Estaba hardcodeado en cada route — centralizado acá
 * para evitar divergencias y facilitar tests/migraciones futuras.
 */
export const DEFAULT_BRANCH_ID = "00000000000000000000000000000001";

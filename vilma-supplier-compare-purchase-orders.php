<?php
/**
 * Plugin Name: Vilma Supplier Compare - Purchase Orders (Addon)
 * Description: Módulo beta para crear pedidos por proveedor usando precios del plugin Vilma Supplier Compare. Incluye semáforo de stock, mínimos, y asignación obligatoria de proveedor válido.
 * Version: 0.2.9-beta
 * Author: Vilma Skincare Store
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) { exit; }

// Archivo principal del plugin (para usar en plugins_url dentro de traits).
if (!defined('VSC_PO_ADDON_FILE')) {
    define('VSC_PO_ADDON_FILE', __FILE__);
}

// Traits (módulos)
require_once __DIR__ . '/includes/traits/trait-bootstrap.php';
require_once __DIR__ . '/includes/traits/trait-shortcode.php';
require_once __DIR__ . '/includes/traits/trait-helpers.php';
require_once __DIR__ . '/includes/traits/trait-rest.php';

final class VSC_PO_Addon {
    const REST_NS = 'vsc-po/v1';
    const NONCE_ACTION = 'wp_rest';
    const PLUGIN_VERSION = '0.2.9-beta';

    use VSC_PO_Trait_Bootstrap;
    use VSC_PO_Trait_Shortcode;
    use VSC_PO_Trait_Helpers;
    use VSC_PO_Trait_REST;
}

VSC_PO_Addon::init();

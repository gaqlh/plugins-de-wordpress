<?php
if (!defined('ABSPATH')) { exit; }

trait VSC_PO_Trait_Bootstrap {
    public static function init() {
            add_action('init', [__CLASS__, 'register_shortcode']);
            add_action('wp_enqueue_scripts', [__CLASS__, 'register_assets']);
            add_action('rest_api_init', [__CLASS__, 'register_routes']);
            add_action('admin_notices', [__CLASS__, 'check_dependencies']);
        }

    public static function check_dependencies() {
            if (!class_exists('WooCommerce')) {
                echo '<div class="notice notice-error"><p><strong>Vilma Supplier Compare - Purchase Orders:</strong> Requiere WooCommerce activo para funcionar correctamente.</p></div>';
            }
            
            if (!self::tables_exist()) {
                echo '<div class="notice notice-warning"><p><strong>Vilma Supplier Compare - Purchase Orders:</strong> Las tablas de proveedores no existen. Asegúrate de que el plugin principal Vilma Supplier Compare esté instalado y activo.</p></div>';
            }
        }

    public static function tables_exist() {
            global $wpdb;
            $t = self::db_tables();
            
            $suppliers_table = $wpdb->get_var("SHOW TABLES LIKE '{$t['suppliers']}'");
            $prices_table = $wpdb->get_var("SHOW TABLES LIKE '{$t['prices']}'");
            
            return $suppliers_table === $t['suppliers'] && $prices_table === $t['prices'];
        }
}

<?php
if (!defined('ABSPATH')) { exit; }

trait VSC_PO_Trait_Helpers {
    private static function db_tables() {
            global $wpdb;
            return [
                'suppliers' => $wpdb->prefix . 'vilma_suppliers',
                'prices'    => $wpdb->prefix . 'vilma_supplier_prices',
            ];
        }

    private static function normalize_money($v) {
            if ($v === null || $v === '') return null;
            $v = str_replace(',', '.', (string)$v);
            $f = floatval($v);
            return $f;
        }

    private static function get_stock_data($product_id) {
            $product = wc_get_product($product_id);
            if (!$product) {
                return [
                    'manage_stock' => false,
                    'stock_quantity' => null,
                    'low_stock_amount' => null,
                ];
            }
    
            $manage = (bool)$product->get_manage_stock();
            $qty = $manage ? $product->get_stock_quantity() : null;
    
            $low = $product->get_low_stock_amount();
            if ($low === '' || $low === null) {
                $opt = get_option('woocommerce_notify_low_stock_amount', '');
                $low = ($opt === '' || $opt === null) ? null : intval($opt);
            } else {
                $low = intval($low);
            }
    
            return [
                'manage_stock' => $manage,
                'stock_quantity' => ($qty === null ? null : intval($qty)),
                'low_stock_amount' => ($low === null ? null : intval($low)),
            ];
        }

    private static function compute_stock_status($manage_stock, $qty, $min) {
            if (!$manage_stock || $min === null) return 'pending';
            if ($qty === null) return 'pending';
            if (intval($qty) === 0) return 'out';
            if (intval($qty) <= intval($min)) return 'low';
            return 'good';
        }

    private static function get_best_supplier_for_product($product_id) {
            global $wpdb;
            $t = self::db_tables();
            
            $sql = $wpdb->prepare(
                "SELECT supplier_id, wholesale_cost
                 FROM {$t['prices']}
                 WHERE product_id = %d AND is_available = 1 AND wholesale_cost > 0
                 ORDER BY wholesale_cost ASC
                 LIMIT 1",
                $product_id
            );
            $row = $wpdb->get_row($sql, ARRAY_A);
            if (!$row) {
                return [null, null];
            }
            return [intval($row['supplier_id']), floatval($row['wholesale_cost'])];
        }

    private static function get_valid_suppliers_for_product($product_id) {
            global $wpdb;
            $t = self::db_tables();
    
            $sql = $wpdb->prepare(
                "SELECT s.id as supplier_id, s.name, p.wholesale_cost
                 FROM {$t['prices']} p
                 INNER JOIN {$t['suppliers']} s ON s.id = p.supplier_id
                 WHERE p.product_id = %d AND p.is_available = 1 AND p.wholesale_cost > 0
                 ORDER BY p.wholesale_cost ASC",
                $product_id
            );
    
            $rows = $wpdb->get_results($sql, ARRAY_A);
            if (!$rows) return [];
    
            return array_map(function($r){
                return [
                    'supplier_id' => intval($r['supplier_id']),
                    'name' => (string)$r['name'],
                    'wholesale_cost' => floatval($r['wholesale_cost']),
                ];
            }, $rows);
        }

    private static function has_valid_supplier($product_id) {
            global $wpdb;
            $t = self::db_tables();
            $sql = $wpdb->prepare(
                "SELECT COUNT(*) FROM {$t['prices']}
                 WHERE product_id = %d AND is_available = 1 AND wholesale_cost > 0",
                $product_id
            );
            return intval($wpdb->get_var($sql)) > 0;
        }
}

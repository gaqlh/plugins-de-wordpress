<?php
if (!defined('ABSPATH')) { exit; }

trait VSC_PO_Trait_REST {
    public static function register_routes() {
            register_rest_route(self::REST_NS, '/categories', [
                'methods'  => 'GET',
                'callback' => [__CLASS__, 'rest_categories'],
                'permission_callback' => [__CLASS__, 'perm'],
            ]);
    
            register_rest_route(self::REST_NS, '/suppliers', [
                'methods'  => 'GET',
                'callback' => [__CLASS__, 'rest_suppliers'],
                'permission_callback' => [__CLASS__, 'perm'],
            ]);
    
            register_rest_route(self::REST_NS, '/items', [
                'methods'  => 'GET',
                'callback' => [__CLASS__, 'rest_items'],
                'permission_callback' => [__CLASS__, 'perm'],
            ]);
    
            register_rest_route(self::REST_NS, '/inventory/bulk', [
                'methods'  => 'POST',
                'callback' => [__CLASS__, 'rest_inventory_bulk'],
                'permission_callback' => [__CLASS__, 'perm'],
            ]);
    
            register_rest_route(self::REST_NS, '/assign-supplier', [
                'methods'  => 'POST',
                'callback' => [__CLASS__, 'rest_assign_supplier'],
                'permission_callback' => [__CLASS__, 'perm'],
            ]);
    
            register_rest_route(self::REST_NS, '/item-suppliers', [
                'methods'  => 'GET',
                'callback' => [__CLASS__, 'rest_item_suppliers'],
                'permission_callback' => [__CLASS__, 'perm'],
                'args' => [
                    'product_id' => ['required' => true, 'validate_callback' => 'is_numeric'],
                ]
            ]);
        }

    public static function perm() {
            return current_user_can('manage_woocommerce');
        }

    public static function rest_categories(WP_REST_Request $req) {
            $terms = get_terms([
                'taxonomy' => 'product_cat',
                'hide_empty' => false,
                'orderby' => 'name',
                'order' => 'ASC',
            ]);
            $out = [];
            if (!is_wp_error($terms)) {
                foreach ($terms as $t) {
                    $out[] = ['id' => $t->term_id, 'name' => $t->name, 'count' => $t->count];
                }
            }
            return rest_ensure_response(['categories' => $out]);
        }

    public static function rest_suppliers(WP_REST_Request $req) {
            global $wpdb;
            $t = self::db_tables();
            
            if (!self::tables_exist()) {
                return rest_ensure_response(['suppliers' => []]);
            }
            
            $rows = $wpdb->get_results("SELECT id, name FROM {$t['suppliers']} ORDER BY name ASC", ARRAY_A);
            return rest_ensure_response(['suppliers' => array_map(function($r){
                return ['id'=>intval($r['id']), 'name'=>$r['name']];
            }, $rows ?: [])]);
        }

    public static function rest_items(WP_REST_Request $req) {
            global $wpdb;
    
            $search = sanitize_text_field($req->get_param('search') !== null ? $req->get_param('search') : '');
            $cat = $req->get_param('category') ? intval($req->get_param('category')) : 0;
            $category_ids = $req->get_param('category_ids');
            $stock_filter = sanitize_text_field($req->get_param('stock') !== null ? $req->get_param('stock') : 'all');
            $supplier_id = intval($req->get_param('supplier_id') ? $req->get_param('supplier_id') : 0);
            $supplier_ids = $req->get_param('supplier_ids');
            $page = max(1, intval($req->get_param('page') !== null ? $req->get_param('page') : 1));
            $per_page = min(200, max(1, intval($req->get_param('per_page') !== null ? $req->get_param('per_page') : 20)));
            $offset = ($page - 1) * $per_page;
    
            // Check for exact SKU search (starts with =)
            $exact_sku_search = false;
            if (str_starts_with($search, '=')) {
                $exact_sku_search = true;
                $search = substr($search, 1);
            }
    
            $posts = $wpdb->posts;
            $postmeta = $wpdb->postmeta;
            $term_rel = $wpdb->term_relationships;
            $term_tax = $wpdb->term_taxonomy;
    
            $t = self::db_tables();
    
            $joins = [];
            $where = [];
            $params = [];
    
            $joins[] = "LEFT JOIN $postmeta sku ON (sku.post_id = p.ID AND sku.meta_key = '_sku')";
            $joins[] = "LEFT JOIN $posts parent ON (p.post_type = 'product_variation' AND parent.ID = p.post_parent)";
    
            // Stock meta joins (used for stock filter counting/pagination)
            $joins[] = "LEFT JOIN $postmeta m_manage ON (m_manage.post_id = p.ID AND m_manage.meta_key = '_manage_stock')";
            $joins[] = "LEFT JOIN $postmeta m_stock  ON (m_stock.post_id = p.ID AND m_stock.meta_key = '_stock')";
            $joins[] = "LEFT JOIN $postmeta m_low    ON (m_low.post_id = p.ID AND m_low.meta_key = '_low_stock_amount')";
    
            $where[] = "p.post_status = 'publish'";
            $where[] = "(p.post_type = 'product_variation' OR (p.post_type = 'product' AND NOT EXISTS (
                            SELECT 1 FROM $posts c
                            WHERE c.post_parent = p.ID
                              AND c.post_type = 'product_variation'
                              AND c.post_status = 'publish'
                       )))";
    
            // Search: SKU OR title of variation/simple OR parent title (for variations)
            if ($search !== '') {
                if ($exact_sku_search) {
                    $where[] = "sku.meta_value = %s";
                    $params[] = $search;
                } else {
                    $like = '%' . $wpdb->esc_like($search) . '%';
                    $where[] = "(p.post_title LIKE %s OR sku.meta_value LIKE %s OR (p.post_type = 'product_variation' AND parent.post_title LIKE %s))";
                    $params[] = $like;
                    $params[] = $like;
                    $params[] = $like;
                }
            }

// Category: applies to parent products; variations inherit from parent.
// Supports either single `category` or multiple `category_ids` (array or CSV).
$cats = [];
if ($cat) { $cats[] = $cat; }
if (!empty($category_ids)) {
    if (is_string($category_ids)) {
        $category_ids = array_filter(array_map('trim', explode(',', $category_ids)));
    }
    if (is_array($category_ids)) {
        foreach ($category_ids as $cid) {
            $cid = intval($cid);
            if ($cid) $cats[] = $cid;
        }
    }
}
$cats = array_values(array_unique(array_filter(array_map('intval', $cats))));

if (!empty($cats)) {
    // Expand with children for each selected category
    $term_ids = [];
    foreach ($cats as $c0) {
        $term_ids[] = $c0;
        $children = get_term_children($c0, 'product_cat');
        if (!is_wp_error($children) && is_array($children) && !empty($children)) {
            $term_ids = array_merge($term_ids, array_map('intval', $children));
        }
    }
    $term_ids = array_values(array_unique(array_filter(array_map('intval', $term_ids))));

    if (!empty($term_ids)) {
        $in_terms = implode(',', $term_ids);

        $parent_sub = "SELECT DISTINCT tr.object_id
                       FROM $term_rel tr
                       INNER JOIN $term_tax tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
                       WHERE tt.taxonomy = 'product_cat'
                         AND tt.term_id IN ($in_terms)";

        $where[] = "( (p.post_type = 'product' AND p.ID IN ($parent_sub))
                     OR (p.post_type = 'product_variation' AND p.post_parent IN ($parent_sub)) )";
    } else {
        return rest_ensure_response([
            'items' => [],
            'page' => $page,
            'per_page' => $per_page,
            'total' => 0,
        ]);
    }
}

// Supplier filter: include products that ANY of these suppliers sells (is_available=1 and wholesale_cost>0).
// Supports either single `supplier_id` or multiple `supplier_ids` (array or CSV).
$sups = [];
if ($supplier_id > 0) { $sups[] = $supplier_id; }
if (!empty($supplier_ids)) {
    if (is_string($supplier_ids)) {
        $supplier_ids = array_filter(array_map('trim', explode(',', $supplier_ids)));
    }
    if (is_array($supplier_ids)) {
        foreach ($supplier_ids as $sid) {
            $sid = intval($sid);
            if ($sid) $sups[] = $sid;
        }
    }
}
$sups = array_values(array_unique(array_filter(array_map('intval', $sups))));

if (!empty($sups)) {
    if (!self::tables_exist()) {
        return rest_ensure_response([
            'items' => [],
            'page' => $page,
            'per_page' => $per_page,
            'total' => 0,
        ]);
    }

    // Build placeholders for IN clause
    $placeholders = implode(',', array_fill(0, count($sups), '%d'));
    $where[] = "EXISTS (SELECT 1 FROM {$t['prices']} sp
                       WHERE sp.product_id = p.ID
                         AND sp.supplier_id IN ($placeholders)
                         AND sp.is_available = 1
                         AND sp.wholesale_cost > 0)";
    foreach ($sups as $sid) { $params[] = $sid; }
}

// Stock filter must be applied at SQL level so pagination/total reflects filtered set.
            // Mirror compute_stock_status() logic as closely as possible using postmeta.
            if ($stock_filter && $stock_filter !== 'all') {
                $default_low_opt = get_option('woocommerce_notify_low_stock_amount', '');
                $default_low = ($default_low_opt === '' || $default_low_opt === null) ? null : intval($default_low_opt);
    
                // manage stock: yes/no
                $manage_yes = "(m_manage.meta_value = 'yes')";
    
                // min stock: product-specific _low_stock_amount, fallback to global option if set.
                if ($default_low === null) {
                    $min_expr = "NULLIF(m_low.meta_value,'')";
                } else {
                    $min_expr = "COALESCE(NULLIF(m_low.meta_value,''), " . intval($default_low) . ")";
                }
    
                // qty: _stock (treat empty as 0 for filtering purposes)
                $qty_expr = "CAST(COALESCE(NULLIF(m_stock.meta_value,''),'0') AS SIGNED)";
    
                if ($stock_filter === 'pending') {
                    $where[] = "($manage_yes = 0 OR $min_expr IS NULL)";
                } elseif ($stock_filter === 'out') {
                    $where[] = "($manage_yes = 1 AND $min_expr IS NOT NULL AND $qty_expr = 0)";
                } elseif ($stock_filter === 'low') {
                    $where[] = "($manage_yes = 1 AND $min_expr IS NOT NULL AND $qty_expr > 0 AND $qty_expr <= CAST($min_expr AS SIGNED))";
                } elseif ($stock_filter === 'good') {
                    $where[] = "($manage_yes = 1 AND $min_expr IS NOT NULL AND $qty_expr > CAST($min_expr AS SIGNED))";
                }
            }
    
            $where_sql = 'WHERE ' . implode(' AND ', $where);
            $join_sql = implode(' ', $joins);
    
            $count_sql = "SELECT COUNT(DISTINCT p.ID) FROM $posts p $join_sql $where_sql";
            $count_sql = !empty($params) ? $wpdb->prepare($count_sql, $params) : $count_sql;
            $total = intval($wpdb->get_var($count_sql));
    
            $ids_sql = "SELECT DISTINCT p.ID
                        FROM $posts p
                        $join_sql
                        $where_sql
                        ORDER BY p.post_date DESC
                        LIMIT %d OFFSET %d";
            $params2 = $params;
            $params2[] = $per_page;
            $params2[] = $offset;
            $ids_sql = $wpdb->prepare($ids_sql, $params2);
    
            $page_ids = $wpdb->get_col($ids_sql) ?: [];
    
            $items = [];
            foreach ($page_ids as $pid) {
                $pid = intval($pid);
                if (!$pid) continue;
    
                $product = wc_get_product($pid);
                if (!$product) continue;
    
                // Seguridad extra: nunca incluir el padre variable
                if ($product->is_type('variable')) continue;
    
                $sku_v = $product->get_sku();
                $name = $product->get_name();
                $img_id = $product->get_image_id();
                $img = $img_id ? wp_get_attachment_image_url($img_id, 'woocommerce_thumbnail') : wc_placeholder_img_src('woocommerce_thumbnail');
    
                $stock = self::get_stock_data($pid);
                $status = self::compute_stock_status($stock['manage_stock'], $stock['stock_quantity'], $stock['low_stock_amount']);
    
                // Suppliers for this product (valid = is_available=1 AND wholesale_cost>0)
                $supplier_choices = [];
                $has_supplier = false;
    
                if (self::tables_exist()) {
                    $supplier_choices = self::get_valid_suppliers_for_product($pid);
                    $has_supplier = !empty($supplier_choices);
                }
    
                // Best (cheapest) supplier among valid choices
                $best_supplier_id = $has_supplier ? intval($supplier_choices[0]['supplier_id']) : null;
                $best_wholesale = $has_supplier ? floatval($supplier_choices[0]['wholesale_cost']) : null;
    
                // Current selection defaults
                $current_supplier_id = $best_supplier_id;
                $current_wholesale = $best_wholesale;
    
                if ($supplier_id > 0 && $has_supplier) {
                    foreach ($supplier_choices as $sc) {
                        if (intval($sc['supplier_id']) === intval($supplier_id)) {
                            $current_supplier_id = intval($sc['supplier_id']);
                            $current_wholesale = floatval($sc['wholesale_cost']);
                            break;
                        }
                    }
                }
    
                $items[] = [
                    'id' => $pid,
                    'sku' => (string)$sku_v,
                    'name' => (string)$name,
                    'img' => (string)$img,
                    'manage_stock' => (bool)$stock['manage_stock'],
                    'stock_quantity' => $stock['stock_quantity'],
                    'min_stock' => $stock['low_stock_amount'],
                    'stock_status' => $status,
                    'best_supplier_id' => $best_supplier_id,
                    'best_wholesale' => $best_wholesale,
                    'has_valid_supplier' => $has_supplier,
                    'supplier_choices' => $supplier_choices,
                    'current_supplier_id' => $current_supplier_id,
                    'current_wholesale' => $current_wholesale,
                ];
            }
    
            return rest_ensure_response([
                'items' => $items,
                'page' => $page,
                'per_page' => $per_page,
                'total' => $total,
            ]);
        }

    public static function rest_inventory_bulk(WP_REST_Request $req) {
            $payload = $req->get_json_params();
            if (!is_array($payload) || empty($payload['updates']) || !is_array($payload['updates'])) {
                return new WP_REST_Response(['error' => 'Payload inválido.'], 400);
            }
    
            $results = [];
            foreach ($payload['updates'] as $u) {
                $pid = intval($u['product_id'] ?? 0);
                if (!$pid) continue;
                $p = wc_get_product($pid);
                if (!$p) continue;
    
                // manage stock
                if (array_key_exists('manage_stock', $u)) {
                    $p->set_manage_stock((bool)$u['manage_stock']);
                }
    
                // min stock (low stock threshold)
                if (array_key_exists('min_stock', $u)) {
                    $min = $u['min_stock'];
                    if ($min === '' || $min === null) {
                        $p->set_low_stock_amount('');
                    } else {
                        $p->set_low_stock_amount(max(0, intval($min)));
                    }
                }
    
                // stock quantity (optional)
                if (array_key_exists('stock_quantity', $u)) {
                    $qty = $u['stock_quantity'];
                    if ($qty === '' || $qty === null) {
                        // do not unset quantity; keep
                    } else {
                        $p->set_stock_quantity(max(0, intval($qty)));
                        // Ensure stock status
                        if (intval($qty) <= 0) {
                            $p->set_stock_status('outofstock');
                        } else {
                            $p->set_stock_status('instock');
                        }
                    }
                }
    
                $p->save();
    
                $stock = self::get_stock_data($pid);
                $results[] = [
                    'product_id' => $pid,
                    'manage_stock' => (bool)$stock['manage_stock'],
                    'stock_quantity' => $stock['stock_quantity'],
                    'min_stock' => $stock['low_stock_amount'],
                    'stock_status' => self::compute_stock_status($stock['manage_stock'], $stock['stock_quantity'], $stock['low_stock_amount']),
                ];
            }
    
            return rest_ensure_response(['updated' => $results]);
        }

    public static function rest_assign_supplier(WP_REST_Request $req) {
            global $wpdb;
            
            if (!self::tables_exist()) {
                return new WP_REST_Response(['error' => 'Las tablas de proveedores no existen.'], 500);
            }
            
            $t = self::db_tables();
            $payload = $req->get_json_params();
            $pid = intval($payload['product_id'] ?? 0);
            $sid = intval($payload['supplier_id'] ?? 0);
            $wholesale = self::normalize_money($payload['wholesale_cost'] ?? null);
    
            if (!$pid || !$sid || $wholesale === null || $wholesale <= 0) {
                return new WP_REST_Response(['error' => 'Debes elegir proveedor y colocar un mayorista válido (> 0).'], 400);
            }

            // Si el producto no tiene SKU, exigirlo (solo en este flujo de asignación de proveedor)
            $product = wc_get_product($pid);
            if (!$product) {
                return new WP_REST_Response(['error' => 'Producto no encontrado.'], 404);
            }

            $current_sku = $product->get_sku();
            $incoming_sku = isset($payload['sku']) ? wc_clean((string)$payload['sku']) : '';
            $incoming_sku = trim($incoming_sku);

            if (empty($current_sku)) {
                if (empty($incoming_sku)) {
                    return new WP_REST_Response(['error' => 'Este producto no tiene SKU. Debes asignar un SKU para poder guardar el proveedor.'], 400);
                }
                $other_id = wc_get_product_id_by_sku($incoming_sku);
                if ($other_id && intval($other_id) !== $pid) {
                    return new WP_REST_Response(['error' => 'El SKU ya está en uso por otro producto. Usa un SKU diferente.'], 400);
                }
                $product->set_sku($incoming_sku);
                $product->save();
                $current_sku = $incoming_sku;
            }
    
            // Check if supplier exists
            $supplier_exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM {$t['suppliers']} WHERE id = %d",
                $sid
            ));
            
            if (!$supplier_exists) {
                return new WP_REST_Response(['error' => 'El proveedor seleccionado no existe.'], 400);
            }
    
            // Upsert price row
            $now = current_time('mysql');
    
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM {$t['prices']} WHERE product_id=%d AND supplier_id=%d",
                $pid, $sid
            ));
    
            if (intval($exists) > 0) {
                $wpdb->update(
                    $t['prices'],
                    [
                        'wholesale_cost' => $wholesale,
                        'is_available'   => 1,
                        'updated_at'     => $now,
                    ],
                    [
                        'product_id'  => $pid,
                        'supplier_id' => $sid,
                    ],
                    ['%f','%d','%s'],
                    ['%d','%d']
                );
            } else {
                $wpdb->insert(
                    $t['prices'],
                    [
                        'product_id'     => $pid,
                        'supplier_id'    => $sid,
                        'wholesale_cost' => $wholesale,
                        'retail_cost'    => null,
                        'is_available'   => 1,
                        'updated_at'     => $now,
                    ],
                    ['%d','%d','%f','%f','%d','%s']
                );
            }
    
            [$best_supplier_id, $best_wholesale] = self::get_best_supplier_for_product($pid);
            $supplier_choices = self::get_valid_suppliers_for_product($pid);
    
            return rest_ensure_response([
                'ok' => true,
                'best_supplier_id' => $best_supplier_id,
                'best_wholesale' => $best_wholesale,
                'supplier_choices' => $supplier_choices,
                'sku' => $current_sku,
            ]);
        }

    public static function rest_item_suppliers(WP_REST_Request $req) {
            global $wpdb;
            
            if (!self::tables_exist()) {
                return rest_ensure_response(['suppliers' => []]);
            }
            
            $t = self::db_tables();
            $pid = intval($req->get_param('product_id') ?? 0);
            if (!$pid) {
                return new WP_REST_Response(['error' => 'product_id requerido'], 400);
            }
    
            $sql = $wpdb->prepare(
                "SELECT s.id as supplier_id, s.name, p.wholesale_cost
                 FROM {$t['prices']} p
                 INNER JOIN {$t['suppliers']} s ON s.id = p.supplier_id
                 WHERE p.product_id = %d AND p.is_available = 1 AND p.wholesale_cost > 0
                 ORDER BY p.wholesale_cost ASC",
                $pid
            );
            $rows = $wpdb->get_results($sql, ARRAY_A) ?: [];
            $suppliers = array_map(function($r){
                return [
                    'supplier_id' => intval($r['supplier_id']),
                    'name' => $r['name'],
                    'wholesale_cost' => floatval($r['wholesale_cost']),
                ];
            }, $rows);
    
            return rest_ensure_response(['suppliers' => $suppliers]);
        }
}

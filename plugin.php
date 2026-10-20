<?php
/*
Plugin Name: QR Code Designer
Plugin URI: https://github.com/Waterproof-Web-Wizard-GmbH/yourls-qr-code-designer
Description: Styled QR codes for every short URL: colours, dot and corner shapes, logo, PNG, SVG and JPG export. Rendered in the browser, no external service.
Version: 1.0.0
Author: Waterproof Web Wizard GmbH
Author URI: https://waterproof-web-wizard.com/
Text Domain: qr-code-designer
Domain Path: /languages
*/

namespace WaterproofWebWizard\QrCodeDesigner;

if ( !defined( 'YOURLS_ABSPATH' ) ) {
    die();
}

const VERSION     = '1.0.0';
const DOMAIN      = 'qr-code-designer';
const PAGE        = 'qr_code_designer';
const LIB_VERSION = '1.9.2';
const JSQR_VERSION = '1.4.0';

require_once __DIR__ . '/includes/functions.php';

yourls_add_action( 'plugins_loaded', __NAMESPACE__ . '\\init' );
yourls_add_filter( 'table_add_row_action_array', __NAMESPACE__ . '\\row_action' );
yourls_add_action( 'html_head', __NAMESPACE__ . '\\head' );

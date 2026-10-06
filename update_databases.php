<?php

class AllDbConnections
{

    private $dirs = array();
    private $servidor;
    private $usuario;
    private $pass;
    private $bd;
    private $puerto;
    private $char;

    public function __construct()
    {
        $this->dirs = array_filter(glob('../../*'), 'is_dir');
        for ($i = 0; $i < count($this->dirs); $i++) {
            $this->dirs[$i] = str_replace("../", "", $this->dirs[$i]);
        }
    }

    function Conectar($dir)
    {

        $path = "/home/";
        if (@include_once($path . $dir . "/configs/config_site.php")) {
            include_once($path . $dir . "/configs/config_site.php");
            $this->servidor = $arrayConfig['db_host'];
            $this->usuario = $arrayConfig['db_user'];
            $this->pass = $arrayConfig['db_pass'];
            $this->bd = $arrayConfig['db_name'];
            $this->puerto = $arrayConfig['db_port'];
            $this->char = $arrayConfig['db_char'];

            $descriptor = mysqli_connect($this->servidor . ":" . $this->puerto, $this->usuario, $this->pass, $this->bd);

            if (!$descriptor) {
                // die('No se pudo conectar: ' . mysqli_connect_error());
                return $descriptor = '1';
            }

            if (!$descriptor->set_charset($this->char)) {
                // die("Error cambiando el juego de caracteres ".$this->char);
                return $descriptor = '2';
            }

            //mysql_select_db($bd, $descriptor) or die (mysql_error());

            return $descriptor;
        } else {
            return $descriptor = '0';
        }
    }

    function SQLExec($consultas)
    {

        foreach ($this->dirs as $dir) {

            $descriptor = $this->Conectar($dir);
            if ($descriptor == '0') {
                echo "\nNO DATA BASE FOUND IN DIRECTORY " . $dir . "\n";
            } elseif ($descriptor == '1') {
                echo "\nNo se pudo conectar: " . mysqli_connect_error() . " , directory " . $dir . " \n";
            } elseif ($descriptor == '2') {
                echo "\nError cambiando el juego de caracteres " . $this->char . " , directory " . $dir . " \n";
            } else {
                
                foreach ($consultas as $consulta) {
                    $mysqliError = false;
                    $csr = mysqli_query($descriptor, $consulta) or $mysqliError = mysqli_error($descriptor);
    
                    $rowarray = array();
    
                    //mysql_data_seek($csr, 0);
                    while ($reg = mysqli_fetch_array($csr, MYSQLI_ASSOC)) {
                        array_push($rowarray, $reg);
                    }
    
                    if ($mysqliError) {
                        echo "\nERROR: " . $mysqliError . " , directory " . $dir . "\n\n";
                    } else {
                        echo "\nDATABASE MODIFIED " . $dir . "\n";
                        
                    }
                    
                    // if(count($rowarray) > 0){
                    //     echo "\n\n\n\n\n\n\n\n".print_r($rowarray,1)."\n\n\n\n\n\n";
                    // }
                }

                mysqli_free_result($csr);
                mysqli_close($descriptor);
            }
        }

        foreach ($consultas as $consulta) {
            $date = date("Y-m-d H:i:s");
            file_put_contents("/home/scripts/db_modification/DataBasesExecutes.txt", "\nFECHA: " . $date . " | " . $consulta . "\n\n", FILE_APPEND);
        }
    }
}


$db = new AllDbConnections();

include_once("/home/scripts/db_modification/queries_update.php");

$db->SQLExec($queries);
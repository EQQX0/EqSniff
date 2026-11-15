//! `eqnet`: EqNetwork without the window. All the work lives in network_toolkit_lib::cli.
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(network_toolkit_lib::cli::main(args));
}

#[path = "../src/gateway.rs"]
mod gateway;

fn main() -> std::process::ExitCode {
    let mut arguments = std::env::args_os().skip(1);
    let Some(data_dir) = arguments.next() else {
        eprintln!("Usage: gateway-check DATA_DIR ENGINE [ARGUMENTS...]");
        return std::process::ExitCode::FAILURE;
    };
    let Some(engine) = arguments.next() else {
        eprintln!("An OpenCode engine path is required");
        return std::process::ExitCode::FAILURE;
    };
    let mut command = std::process::Command::new(engine);
    command.args(arguments);
    if let Err(error) = gateway::apply(&mut command, Some(std::path::Path::new(&data_dir))) {
        eprintln!("{error}");
        return std::process::ExitCode::FAILURE;
    }
    match command.status() {
        Ok(status) if status.success() => std::process::ExitCode::SUCCESS,
        Ok(_) => std::process::ExitCode::FAILURE,
        Err(_) => {
            eprintln!("Could not launch the isolated OpenCode engine");
            std::process::ExitCode::FAILURE
        }
    }
}

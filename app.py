from datetime import datetime
from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('page.html')

@app.route("/move/<cmd>")
def move_cmd(cmd):
    if cmd in ("forward", "backward", 'left', "right", "stop"):
        current_time = datetime.now().strftime("%I:%M:%S %p")

        print(f"Command received: {cmd} at {current_time}") # later replace iwth motor code
        return f"Got: {cmd}"
    return "Unkown command", 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
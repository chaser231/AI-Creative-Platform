const { FAL_KEY } = process.env;

// just testing what fal-ai/flux-lora generates for "Наушники Apple"
async function run() {
  const res = await fetch("https://queue.fal.run/fal-ai/flux-lora", {
    method: "POST",
    headers: {
      "Authorization": `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "Наушники Apple",
      image_size: "square_hd",
      loras: [{ path: "https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors", scale: 1 }]
    })
  });
  console.log(await res.json());
}
run();

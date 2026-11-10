import { useContext, useState } from "react";
import { Button, Form, FormControl } from "react-bootstrap";
import { AtlantContext } from "../../../core/context.jsx";

const RegisterVehicle = () => {
    const { post } = useContext(AtlantContext);

    const [category, setCategory] = useState("");
    const [marketValue, setMarketValue] = useState("");
    const [serviceLife, setServiceLife] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();

        await post("RegisterVehicle", [category, marketValue, serviceLife]);
    };

    return (
        <Form onSubmit={handleSubmit}>
            <h2>RegisterVehicle</h2>
            <FormControl placeholder="Категория ТС A, B или C" onChange={(e) => setCategory(e.target.value)} />
            <hr/>
            <FormControl placeholder="Рыночная стоимость, ProfiCoin" onChange={(e) => setMarketValue(e.target.value)} />
            <hr/>
            <FormControl placeholder="Срок эксплуатации, лет" onChange={(e) => setServiceLife(e.target.value)} />

            <Button type="submit">Отправить</Button>
        </Form>
    );
};

export default RegisterVehicle;

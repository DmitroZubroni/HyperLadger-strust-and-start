import { useContext } from "react";
import { Tabs, Tab } from "react-bootstrap";
import { AtlantContext } from "../../core/context.jsx";

import Header from "../component/Header.jsx";
import Authorization from "../component/Authorization.jsx";

import RegisterDriver from "../component/func/RegisterDriver.jsx";

import AddLicense from "../component/func/AddLicense.jsx";
import RegisterVehicle from "../component/func/RegisterVehicle.jsx";
import RenewLicense from "../component/func/RenewLicense.jsx";
import PayFine from "../component/func/PayFine.jsx";

import IssueFine from "../component/func/IssueFine.jsx";

const Function = () => {
    const { isAuthorized } = useContext(AtlantContext);

    return (
        <div>
            <Header />

            {!isAuthorized ? (
                <Authorization />
            ) : (
                <div className="container">
                    <Tabs>
                        <Tab eventKey="register" title="Регистрация водителя">
                            <RegisterDriver />
                        </Tab>

                        <Tab eventKey="driver" title="Водитель">
                            <AddLicense />
                            <hr />
                            <RegisterVehicle />
                            <hr />
                            <RenewLicense />
                            <hr />
                            <PayFine />
                        </Tab>

                        <Tab eventKey="dps" title="Сотрудник ДПС">
                            <IssueFine />
                        </Tab>
                    </Tabs>
                </div>
            )}
        </div>
    );
};

export default Function;
